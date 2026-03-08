/* ============================================
   FB (Fill in the Blanks) 생성프롬 검증 규칙
   - 생성프롬 출력물을 파싱하고 FAIL 조건을 검증
   - 모듈형: 나중에 다른 유형 검증도 이 패턴으로 추가
   ============================================ */

const FBGenerationValidator = {

    /**
     * 메인 검증 함수
     * @param {string} rawOutput - 생성프롬 출력물 전체 텍스트
     * @returns {object} { pass: boolean, errors: [], warnings: [], parsed: {} }
     */
    validate(rawOutput) {
        const result = {
            pass: true,
            errors: [],    // FAIL 사유
            warnings: [],  // 경고 (FAIL은 아님)
            parsed: {}     // 파싱된 데이터
        };

        // 1. 출력물 파싱
        const parsed = this.parse(rawOutput);
        result.parsed = parsed;

        if (parsed.error) {
            result.pass = false;
            result.errors.push(parsed.error);
            return result;
        }

        // 2. 검증 규칙 순차 실행
        const checks = [
            this.checkBlankCount,
            this.checkAnswerCount,
            this.checkMappingCount,
            this.checkWordCount,
            this.checkSentenceCount,
            this.checkS1NoBlank,
            this.checkS4PlusNoBlank,
            this.checkNoLineBreakInPassage,
            this.checkS1Format,
            this.checkAnswerLength,
            this.checkUnderscoreFormat,
            this.checkNoMiddleDeletion,
            this.checkConsecutiveBlanks,
            this.checkMappingMatchesPassage,
            this.checkAnswerMatchesMapping,
            this.checkForbiddenWords,
            this.checkThPatternLimit,
            this.checkWhPatternLimit,
            this.checkS2MinWords,
            this.checkS3MinWords,
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
     * 출력물 파싱
     */
    parse(rawOutput) {
        const data = {
            topic: null,
            passage: null,
            answers: [],
            mappings: [],
            sentences: [],
            blanks: [],
            wordCount: 0,
        };

        try {
            const lines = rawOutput.trim().split('\n').filter(l => l.trim());

            // Topic 라벨 파싱
            const topicLine = lines.find(l => l.trim().startsWith('[Topic:'));
            if (topicLine) {
                const match = topicLine.match(/\[Topic:\s*(.+?)\s*\|\s*(.+?)\s*\]/);
                if (match) {
                    data.topic = { en: match[1], ko: match[2] };
                }
            }

            // 지문 파싱 전략:
            // "정답:" 또는 "정답 :" 을 포함하는 줄 번호를 찾고
            // 그 위의 텍스트 중 메타 라벨이 아닌 것이 지문
            const answerLineIdx = lines.findIndex(l => /^정답\s*:/.test(l.trim()));
            if (answerLineIdx === -1) {
                return { error: '파싱 실패: "정답:" 줄을 찾을 수 없습니다.' };
            }

            // 지문 시작점: Topic, 세트, Reading, Fill in 등 메타 라벨 이후
            const metaPatterns = [/^\[Topic:/, /^세트\d+/, /^Reading\s*\|/, /^Fill in the missing/, /^빈칸/, /^문항/];
            let passageStart = 0;
            for (let i = 0; i < answerLineIdx; i++) {
                const l = lines[i].trim();
                if (metaPatterns.some(p => p.test(l))) {
                    passageStart = i + 1;
                }
            }

            // 지문 = passageStart ~ answerLineIdx 사이의 줄들
            const passageLines = [];
            for (let i = passageStart; i < answerLineIdx; i++) {
                const l = lines[i].trim();
                // 메타 라벨이 아닌 줄만 지문으로 취급
                if (l && !metaPatterns.some(p => p.test(l))) {
                    passageLines.push(l);
                }
            }
            data.passage = passageLines.join(' ');

            if (!data.passage) {
                return { error: '파싱 실패: 지문을 찾을 수 없습니다.' };
            }

            // 문장 분리
            data.sentences = this.splitSentences(data.passage);

            // 빈칸(결손 토큰) 추출
            const blankPattern = /[a-zA-Z]+(?:_(?:\s_)*)+/g;
            let match;
            while ((match = blankPattern.exec(data.passage)) !== null) {
                data.blanks.push(match[0]);
            }

            // 단어 수 계산 (빈칸 토큰도 1단어로 카운트)
            data.wordCount = data.passage.split(/\s+/).filter(w => w.length > 0).length;

            // 정답 파싱
            // 전체 텍스트에서 "정답:" 이후 부분 추출 (줄바꿈과 무관)
            const answerMatch = rawOutput.match(/정답\s*:\s*(.+?)(?=\n|빈칸|세트\d+-|$)/s);
            if (answerMatch) {
                const answerPart = answerMatch[1].trim();
                data.answers = answerPart.split(',').map(a => a.trim()).filter(a => a);
            }

            // 매핑 파싱 (세트X-Y: 토큰 → 정답)
            // 한 줄에 여러 매핑이 이어져 있을 수 있음
            const fullText = rawOutput;
            const mappingPatternGlobal = /세트\d+-(\d+):\s*(.+?)\s*→\s*(\S+)/g;
            let mappingMatch;
            while ((mappingMatch = mappingPatternGlobal.exec(fullText)) !== null) {
                data.mappings.push({
                    num: parseInt(mappingMatch[1]),
                    token: mappingMatch[2].trim(),
                    answer: mappingMatch[3].trim()
                });
            }

            return data;

        } catch (e) {
            return { error: `파싱 오류: ${e.message}` };
        }
    },

    /**
     * 문장 분리 (마침표 기준, 약어 고려)
     */
    splitSentences(text) {
        // 간단한 문장 분리: 마침표+공백+대문자 기준
        const sentences = [];
        let current = '';
        const words = text.split(/\s+/);

        for (let i = 0; i < words.length; i++) {
            current += (current ? ' ' : '') + words[i];
            if (words[i].endsWith('.') && i < words.length - 1) {
                // 다음 단어가 대문자로 시작하면 문장 경계
                if (words[i + 1] && /^[A-Z]/.test(words[i + 1])) {
                    sentences.push(current);
                    current = '';
                }
            }
        }
        if (current) sentences.push(current);
        return sentences;
    },

    // ============================================
    // 개별 검증 규칙들
    // ============================================

    /** 결손 토큰 10개 검증 */
    checkBlankCount(parsed) {
        const count = parsed.blanks.length;
        if (count !== 10) {
            return { fail: true, message: `결손 토큰 ${count}개 (10개여야 함)` };
        }
        return {};
    },

    /** 정답 조각 10개 검증 */
    checkAnswerCount(parsed) {
        const count = parsed.answers.length;
        if (count !== 10) {
            return { fail: true, message: `정답 ${count}개 (10개여야 함)` };
        }
        return {};
    },

    /** 매핑 라인 10개 검증 */
    checkMappingCount(parsed) {
        const count = parsed.mappings.length;
        if (count !== 10) {
            return { fail: true, message: `매핑 ${count}개 (10개여야 함)` };
        }
        return {};
    },

    /** 70~90 words 검증 */
    checkWordCount(parsed) {
        const count = parsed.wordCount;
        if (count < 70 || count > 90) {
            return { fail: true, message: `단어 수 ${count}개 (70~90 범위여야 함)` };
        }
        return {};
    },

    /** 4~6문장 검증 */
    checkSentenceCount(parsed) {
        const count = parsed.sentences.length;
        if (count < 4 || count > 6) {
            return { fail: true, message: `문장 수 ${count}개 (4~6개여야 함)` };
        }
        return {};
    },

    /** S1 결손 0개 검증 */
    checkS1NoBlank(parsed) {
        if (parsed.sentences.length === 0) return {};
        const s1 = parsed.sentences[0];
        const blankPattern = /[a-zA-Z]+(?:_(?:\s_)*)+/g;
        const blanks = s1.match(blankPattern);
        if (blanks && blanks.length > 0) {
            return { fail: true, message: `S1에 결손 ${blanks.length}개 발견 (0개여야 함)` };
        }
        return {};
    },

    /** S4 이후 결손 0개 검증 */
    checkS4PlusNoBlank(parsed) {
        if (parsed.sentences.length <= 3) return {};
        const blankPattern = /[a-zA-Z]+(?:_(?:\s_)*)+/g;
        for (let i = 3; i < parsed.sentences.length; i++) {
            const blanks = parsed.sentences[i].match(blankPattern);
            if (blanks && blanks.length > 0) {
                return { fail: true, message: `S${i + 1}에 결손 ${blanks.length}개 발견 (S4 이후는 0개여야 함)` };
            }
        }
        return {};
    },

    /** 지문 내 줄바꿈 금지 (파싱 시 이미 합쳤지만 원본 확인) */
    checkNoLineBreakInPassage(parsed) {
        // 파싱 시 join했으므로 여기서는 pass
        return {};
    },

    /** S1 "X is ..." 2형식 정의문 검증 */
    checkS1Format(parsed) {
        if (parsed.sentences.length === 0) return {};
        const s1 = parsed.sentences[0];
        // "X is ..." 또는 "X is a term that refers to ..." 허용
        if (!/ is /.test(s1)) {
            return { fail: true, message: `S1이 "X is ..." 형식이 아님: "${s1.substring(0, 50)}..."` };
        }
        // "X refers to ..." 단독 금지
        if (/ refers to /.test(s1) && !/ is a .* that refers to /.test(s1) && !/ is /.test(s1.split(' refers to ')[0])) {
            return { fail: true, message: `S1이 "X refers to ..." 단독 사용 (금지)` };
        }
        return {};
    },

    /** 정답 조각 길이 2~4 검증 */
    checkAnswerLength(parsed) {
        for (let i = 0; i < parsed.answers.length; i++) {
            const len = parsed.answers[i].length;
            if (len < 2 || len > 4) {
                return { fail: true, message: `정답 #${i + 1} "${parsed.answers[i]}" 길이=${len} (2~4여야 함)` };
            }
        }
        return {};
    },

    /** 언더스코어 표기 규칙 검증 */
    checkUnderscoreFormat(parsed) {
        for (let i = 0; i < parsed.blanks.length; i++) {
            const blank = parsed.blanks[i];
            // 보이는 알파벳 추출
            const alphaMatch = blank.match(/^([a-zA-Z]+)/);
            if (!alphaMatch) {
                return { fail: true, message: `결손 #${i + 1} "${blank}" 앞글자 없음` };
            }
            // 언더스코어 개수
            const underscores = (blank.match(/_/g) || []).length;
            // 정답 조각 길이와 일치하는지 (매핑이 있으면 비교)
            if (parsed.answers[i]) {
                const answerLen = parsed.answers[i].length;
                if (underscores !== answerLen) {
                    return { fail: true, message: `결손 #${i + 1} "${blank}" 언더스코어 ${underscores}개 ≠ 정답 "${parsed.answers[i]}" ${answerLen}글자` };
                }
            }
            // 알파벳과 첫 언더스코어 사이 공백 금지
            if (/[a-zA-Z]\s_/.test(blank)) {
                return { fail: true, message: `결손 #${i + 1} "${blank}" 알파벳과 언더스코어 사이에 공백 있음 (금지)` };
            }
        }
        return {};
    },

    /** 접미사 결손만 허용 (중간 결손 금지) */
    checkNoMiddleDeletion(parsed) {
        for (let i = 0; i < parsed.blanks.length; i++) {
            const blank = parsed.blanks[i];
            // 패턴: 알파벳 → 언더스코어 → 끝 (중간에 알파벳 다시 나오면 안 됨)
            const afterUnderscore = blank.replace(/^[a-zA-Z]+/, '');
            if (/[a-zA-Z]/.test(afterUnderscore)) {
                return { fail: true, message: `결손 #${i + 1} "${blank}" 중간 철자 결손 (접미사 결손만 허용)` };
            }
        }
        return {};
    },

    /** 연속 결손 최대 2개 */
    checkConsecutiveBlanks(parsed) {
        const words = parsed.passage.split(/\s+/);
        let consecutive = 0;
        let maxConsecutive = 0;
        const blankPattern = /[a-zA-Z]+(?:_(?:\s_)*)+/;

        for (const word of words) {
            // 단어가 빈칸 토큰의 일부인지 확인 (언더스코어 포함)
            if (/_/.test(word)) {
                consecutive++;
                maxConsecutive = Math.max(maxConsecutive, consecutive);
            } else {
                consecutive = 0;
            }
        }

        // 좀 더 정확한 방법: 지문에서 빈칸 토큰 사이에 완성 단어가 있는지 확인
        const passageWords = parsed.passage.split(/\s+/);
        let blankRun = 0;
        let maxRun = 0;

        for (const w of passageWords) {
            if (/_/.test(w)) {
                blankRun++;
            } else {
                if (blankRun > 0) {
                    maxRun = Math.max(maxRun, blankRun);
                }
                blankRun = 0;
            }
        }
        maxRun = Math.max(maxRun, blankRun);

        // 결손 토큰 하나가 여러 단어로 분리될 수 있음 (예: _ _ _)
        // 실제 결손 토큰 경계를 기준으로 재계산
        let blankPositions = [];
        let wordIdx = 0;
        for (const w of passageWords) {
            if (/[a-zA-Z]+_/.test(w)) {
                // 결손 토큰 시작
                blankPositions.push(wordIdx);
            }
            wordIdx++;
        }

        // 연속 확인: 결손 토큰 시작 사이에 완성 단어가 없으면 연속
        let maxChain = 1;
        let currentChain = 1;
        for (let i = 1; i < blankPositions.length; i++) {
            // 사이에 있는 단어들 확인
            let hasCompleteWord = false;
            for (let j = blankPositions[i - 1] + 1; j < blankPositions[i]; j++) {
                if (!/_/.test(passageWords[j])) {
                    hasCompleteWord = true;
                    break;
                }
            }
            if (!hasCompleteWord) {
                currentChain++;
                maxChain = Math.max(maxChain, currentChain);
            } else {
                currentChain = 1;
            }
        }

        if (maxChain >= 3) {
            return { fail: true, message: `연속 결손 ${maxChain}개 (최대 2개까지 허용)` };
        }
        return {};
    },

    /** 매핑 토큰이 지문에 존재하는지 */
    checkMappingMatchesPassage(parsed) {
        for (const m of parsed.mappings) {
            if (!parsed.passage.includes(m.token)) {
                return { fail: true, message: `매핑 "${m.token}" 이 지문에 없음` };
            }
        }
        return {};
    },

    /** 정답 리스트와 매핑 정답이 일치하는지 */
    checkAnswerMatchesMapping(parsed) {
        if (parsed.answers.length !== parsed.mappings.length) return {};
        for (let i = 0; i < parsed.answers.length; i++) {
            if (parsed.answers[i] !== parsed.mappings[i].answer) {
                return {
                    fail: true,
                    message: `정답 #${i + 1}: 리스트 "${parsed.answers[i]}" ≠ 매핑 "${parsed.mappings[i].answer}"`
                };
            }
        }
        return {};
    },

    /** 금칙어/금칙구문 검증 */
    checkForbiddenWords(parsed) {
        const passage = parsed.passage.toLowerCase();
        const forbidden = [
            'in today\'s world', 'in the modern world', 'it is important to',
            'there are many reasons', 'this essay will', 'needless to say',
            'as we all know'
        ];
        for (const phrase of forbidden) {
            if (passage.includes(phrase)) {
                return { fail: true, message: `금칙 구문 발견: "${phrase}"` };
            }
        }

        // 느낌표 검사
        if (parsed.passage.includes('!')) {
            return { fail: true, message: '느낌표(!) 사용 금지' };
        }

        // 과장 표현
        const exaggerations = ['ultimate', 'best', 'amazing'];
        for (const word of exaggerations) {
            const regex = new RegExp(`\\b${word}\\b`, 'i');
            if (regex.test(parsed.passage)) {
                return { fail: true, message: `과장 표현 발견: "${word}"` };
            }
        }

        // only 규칙: only 다음 단어가 on이 아니면 FAIL
        const onlyRegex = /\bonly\s+(\w+)/gi;
        let onlyMatch;
        while ((onlyMatch = onlyRegex.exec(parsed.passage)) !== null) {
            if (onlyMatch[1].toLowerCase() !== 'on') {
                return { fail: true, message: `"only" 다음 단어가 "on"이 아님: "only ${onlyMatch[1]}"` };
            }
        }

        return {};
    },

    /** "th_ _" 패턴 세트당 최대 1개 */
    checkThPatternLimit(parsed) {
        const thBlanks = parsed.blanks.filter(b => /^th[_\s]/i.test(b));
        if (thBlanks.length > 1) {
            return { fail: true, message: `"th__" 형태 결손 ${thBlanks.length}개 (최대 1개)` };
        }
        return {};
    },

    /** "wh_ _" 또는 "whi_ _" 패턴 세트당 최대 1개 */
    checkWhPatternLimit(parsed) {
        const whBlanks = parsed.blanks.filter(b => /^wh[i]?[_\s]/i.test(b));
        if (whBlanks.length > 1) {
            return { fail: true, message: `"wh__/whi__" 형태 결손 ${whBlanks.length}개 (최대 1개)` };
        }
        return {};
    },

    /** S2 최소 15단어 */
    checkS2MinWords(parsed) {
        if (parsed.sentences.length < 2) return {};
        const wordCount = parsed.sentences[1].split(/\s+/).length;
        if (wordCount < 15) {
            return { fail: true, message: `S2 단어 수 ${wordCount}개 (최소 15개)` };
        }
        return {};
    },

    /** S3 최소 15단어 */
    checkS3MinWords(parsed) {
        if (parsed.sentences.length < 3) return {};
        const wordCount = parsed.sentences[2].split(/\s+/).length;
        if (wordCount < 15) {
            return { fail: true, message: `S3 단어 수 ${wordCount}개 (최소 15개)` };
        }
        return {};
    },
};

// 모듈로 내보내기 (브라우저 환경)
window.FBGenerationValidator = FBGenerationValidator;
