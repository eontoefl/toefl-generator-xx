/* ============================================
   FB (Fill in the Blanks) 해설프롬 검증 규칙
   - passage_with_markers 형식 검증
   - {{ }} 마커 파싱 및 유효성 확인
   ============================================ */

const FBExplanationValidator = {

    /**
     * 메인 검증 함수
     * @param {string} rawOutput - 해설프롬 출력물 (passage_with_markers 형식)
     * @returns {object} { pass: boolean, errors: [], warnings: [], parsed: {} }
     */
    validate(rawOutput) {
        const result = {
            pass: true,
            errors: [],
            warnings: [],
            parsed: {}
        };

        // 1. 파싱
        const parsed = this.parse(rawOutput);
        result.parsed = parsed;

        if (parsed.error) {
            result.pass = false;
            result.errors.push(parsed.error);
            return result;
        }

        // 2. 검증 규칙 순차 실행
        const checks = [
            this.checkMarkerCount,
            this.checkBracketPairs,
            this.checkNoBracketNesting,
            this.checkPipeCount,
            this.checkNoPipeInContent,
            this.checkFrontLettersNotEmpty,
            this.checkBackLettersNotEmpty,
            this.checkExplanationNotEmpty,
            this.checkNoExtraText,
            this.checkCompletedWord,
        ];

        for (const check of checks) {
            const checkResult = check.call(this, parsed);
            if (checkResult.fail) {
                result.pass = false;
                result.errors.push(checkResult.message);
            }
            if (checkResult.warning) {
                result.warnings.push(checkResult.warning);
            }
        }

        return result;
    },

    /**
     * passage_with_markers 파싱
     */
    parse(rawOutput) {
        const data = {
            fullText: rawOutput.trim(),
            markers: [],
            plainText: '',   // 마커 제거한 원문 (검증용)
        };

        try {
            const text = rawOutput.trim();

            // {{ }} 마커 추출
            const markerPattern = /\{\{(.+?)\}\}/gs;
            let match;
            let markerIndex = 0;

            while ((match = markerPattern.exec(text)) !== null) {
                markerIndex++;
                const inner = match[1];
                const parts = this.splitPipes(inner);

                const marker = {
                    index: markerIndex,
                    raw: match[0],
                    position: match.index,
                    pipeCount: parts.length - 1,
                    front: parts[0] || '',        // 정답 앞글자
                    back: parts[1] || '',          // 정답 뒷글자
                    explanation: parts[2] || '',   // 해설문
                    hasWrongAnswer: parts.length === 5,
                    wrongAnswer: parts[3] || null,      // 오답 (있으면)
                    wrongExplanation: parts[4] || null,  // 오답 해설 (있으면)
                    completedWord: (parts[0] || '') + (parts[1] || ''),
                };

                data.markers.push(marker);
            }

            // 원문 복원 (마커를 완성 단어로 치환)
            data.plainText = text.replace(/\{\{(.+?)\}\}/gs, (match, inner) => {
                const parts = this.splitPipes(inner);
                return (parts[0] || '') + (parts[1] || '');
            });

            return data;

        } catch (e) {
            return { error: `파싱 오류: ${e.message}` };
        }
    },

    /**
     * | 기준으로 분리 (해설문 안에 | 가 없어야 하므로 단순 split)
     */
    splitPipes(inner) {
        return inner.split('|');
    },

    // ============================================
    // 개별 검증 규칙들
    // ============================================

    /** 마커 10개 검증 */
    checkMarkerCount(parsed) {
        const count = parsed.markers.length;
        if (count !== 10) {
            return { fail: true, message: `마커 ${count}개 (10개여야 함)` };
        }
        return {};
    },

    /** {{ }} 짝이 맞는지 */
    checkBracketPairs(parsed) {
        const text = parsed.fullText;
        const opens = (text.match(/\{\{/g) || []).length;
        const closes = (text.match(/\}\}/g) || []).length;
        if (opens !== closes) {
            return { fail: true, message: `{{ 개수(${opens}) ≠ }} 개수(${closes}) — 짝이 안 맞음` };
        }
        return {};
    },

    /** 중첩 {{ {{ }} }} 금지 */
    checkNoBracketNesting(parsed) {
        const text = parsed.fullText;
        // {{ 이후 }} 이전에 다시 {{ 가 나오면 중첩
        let depth = 0;
        for (let i = 0; i < text.length - 1; i++) {
            if (text[i] === '{' && text[i + 1] === '{') {
                depth++;
                if (depth > 1) {
                    return { fail: true, message: '중첩 마커 발견 ({{ {{ }} }} 금지)' };
                }
                i++; // skip next {
            } else if (text[i] === '}' && text[i + 1] === '}') {
                depth--;
                i++; // skip next }
            }
        }
        return {};
    },

    /** | 구분자 개수 = 2(기본형) 또는 4(오답형) */
    checkPipeCount(parsed) {
        for (const m of parsed.markers) {
            if (m.pipeCount !== 2 && m.pipeCount !== 4) {
                return {
                    fail: true,
                    message: `마커 #${m.index} "${m.front}|${m.back}|..." 파이프 ${m.pipeCount}개 (2 또는 4여야 함)`
                };
            }
        }
        return {};
    },

    /** 해설문/오답해설문 안에 | 금지 (파이프 개수로 이미 잡히지만 명시적 체크) */
    checkNoPipeInContent(parsed) {
        // 이미 checkPipeCount에서 잡히므로 추가 검증
        // 5개 초과 파이프가 있으면 해설 안에 | 가 있다는 뜻
        for (const m of parsed.markers) {
            if (m.pipeCount > 4) {
                return {
                    fail: true,
                    message: `마커 #${m.index} 해설 안에 | 문자 포함 (출력 깨짐)`
                };
            }
        }
        return {};
    },

    /** 앞글자 비어있지 않은지 */
    checkFrontLettersNotEmpty(parsed) {
        for (const m of parsed.markers) {
            if (!m.front.trim()) {
                return { fail: true, message: `마커 #${m.index} 앞글자(정답_앞글자)가 비어있음` };
            }
        }
        return {};
    },

    /** 뒷글자 비어있지 않은지 */
    checkBackLettersNotEmpty(parsed) {
        for (const m of parsed.markers) {
            if (!m.back.trim()) {
                return { fail: true, message: `마커 #${m.index} 뒷글자(정답_뒷글자)가 비어있음` };
            }
        }
        return {};
    },

    /** 해설문 비어있지 않은지 */
    checkExplanationNotEmpty(parsed) {
        for (const m of parsed.markers) {
            if (!m.explanation.trim()) {
                return { fail: true, message: `마커 #${m.index} "${m.completedWord}" 해설이 비어있음` };
            }
            // 최소 길이 체크 (너무 짧은 해설)
            if (m.explanation.trim().length < 10) {
                return {
                    fail: true,
                    message: `마커 #${m.index} "${m.completedWord}" 해설이 너무 짧음 (${m.explanation.trim().length}자)`
                };
            }
        }
        return {};
    },

    /** 마커 외 불필요한 텍스트(세트X-Y, 제목, 구분선 등) 금지 */
    checkNoExtraText(parsed) {
        const text = parsed.fullText;
        // 세트X-Y 패턴
        if (/세트\d+-\d+/.test(text)) {
            return { fail: true, message: '"세트X-Y" 라벨이 포함되어 있음 (마커 형식만 허용)' };
        }
        // 구분선
        if (/^---+$/m.test(text)) {
            return { fail: true, message: '구분선(---) 이 포함되어 있음' };
        }
        return {};
    },

    /** 앞글자 + 뒷글자 = 실제 영어 단어 형태인지 (기본 체크) */
    checkCompletedWord(parsed) {
        for (const m of parsed.markers) {
            const word = m.completedWord;
            // 알파벳으로만 이루어져야 함
            if (!/^[a-zA-Z]+$/.test(word)) {
                return {
                    fail: true,
                    message: `마커 #${m.index} 완성 단어 "${word}"에 비알파벳 문자 포함`
                };
            }
            // 최소 길이
            if (word.length < 2) {
                return {
                    fail: true,
                    message: `마커 #${m.index} 완성 단어 "${word}" 너무 짧음`
                };
            }
        }
        return {};
    },
};

// 모듈로 내보내기
window.FBExplanationValidator = FBExplanationValidator;
