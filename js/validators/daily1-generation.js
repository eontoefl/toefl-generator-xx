/* ============================================
   Daily1 (Read an email/notice) 생성프롬 검증 규칙
   - 생성프롬 출력물을 파싱하고 FAIL 조건을 검증
   - 단일 세트 기준 검증 (N=2인 경우 세트 분리 후 개별 검증)
   ============================================ */

const Daily1GenerationValidator = {

    /**
     * 메인 검증 함수
     * @param {string} rawOutput - 생성프롬 출력물 전체 텍스트
     * @returns {object} { pass: boolean, errors: [], warnings: [], parsed: {} }
     */
    validate(rawOutput) {
        const result = {
            pass: true,
            errors: [],
            warnings: [],
            parsed: {}
        };

        // 1. 세트 분리 (다중 세트 지원)
        const sets = this.splitSets(rawOutput);
        result.parsed.setCount = sets.length;
        result.parsed.sets = [];

        if (sets.length === 0) {
            result.pass = false;
            result.errors.push('세트를 찾을 수 없습니다. 출력 형식을 확인하세요.');
            return result;
        }

        // 2. 각 세트 개별 검증
        for (let i = 0; i < sets.length; i++) {
            const setRaw = sets[i];
            const setNum = i + 1;
            const parsed = this.parseSet(setRaw, setNum);

            result.parsed.sets.push(parsed);

            if (parsed.error) {
                result.pass = false;
                result.errors.push(`[세트${setNum}] ${parsed.error}`);
                continue;
            }

            // 검증 규칙 실행
            const checks = [
                this.checkMainTitle,
                this.checkTopicLabel,
                this.checkEmailHeaders,
                this.checkPassageWordCount,
                this.checkQuestionsExist,
                this.checkQuestionCount,
                this.checkOptionsCount,
                this.checkAnswerKeyExists,
                this.checkAnswerKeyValid,
                this.checkForbiddenWords,
                this.checkNoEmoji,
                this.checkExcludedTopics,
            ];

            for (const check of checks) {
                const checkResult = check.call(this, parsed, setNum);
                if (checkResult.fail) {
                    result.pass = false;
                    result.errors.push(checkResult.message);
                }
                if (checkResult.warning) {
                    result.warnings.push(checkResult.warning);
                }
            }
        }

        // 3. 다중 세트 간 검증
        if (sets.length > 1) {
            const crossCheck = this.checkCrossSetDuplicate(result.parsed.sets);
            if (crossCheck.fail) {
                result.pass = false;
                result.errors.push(crossCheck.message);
            }
        }

        return result;
    },

    /**
     * 다중 세트 분리
     * 구분선(---) 또는 [세트 N] 패턴으로 분리
     */
    splitSets(rawOutput) {
        const cleaned = rawOutput.replace(/\*\*/g, '').trim();

        // [세트1], [세트2] 또는 세트1, 세트2 패턴으로 분리 시도
        // 또는 --- 구분선으로 분리
        const setPattern = /(?:^|\n)(?:---+\s*\n)?(?:\[?세트\s*(\d+)\]?|세트(\d+))\s*/g;
        const matches = [...cleaned.matchAll(setPattern)];

        if (matches.length >= 2) {
            const sets = [];
            for (let i = 0; i < matches.length; i++) {
                const start = matches[i].index;
                const end = i + 1 < matches.length ? matches[i + 1].index : cleaned.length;
                sets.push(cleaned.substring(start, end).trim());
            }
            return sets;
        }

        // 구분선으로만 분리 시도
        const dashSplit = cleaned.split(/\n---+\n/).filter(s => s.trim());
        if (dashSplit.length >= 2) {
            return dashSplit.map(s => s.trim());
        }

        // 단일 세트
        return [cleaned];
    },

    /**
     * 개별 세트 파싱
     */
    parseSet(rawSet, setNum) {
        const data = {
            setNum: setNum,
            mainTitle: null,      // "Read an email." 또는 "Read a notice."
            type: null,           // 'email' 또는 'notice'
            topicLabel: null,     // 【주제: X / 핵심 내용: Y】
            topic: null,          // 주제 키워드
            coreContent: null,    // 핵심 내용
            passage: null,        // 지문 전체 텍스트
            passageWordCount: 0,
            headers: {},          // 이메일 헤더 (To, From, Date, Subject)
            questions: [],        // [{question, options: [A,B,C,D]}]
            answerKey: null,      // {q1: 'A', q2: 'B'}
            raw: rawSet,
        };

        try {
            const lines = rawSet.split('\n').map(l => l.trim());

            // 1. 대제목 파싱: "Read an email." 또는 "Read a notice."
            const titleLine = lines.find(l => /Read an?\s+(email|notice)/i.test(l));
            if (titleLine) {
                const titleMatch = titleLine.match(/Read an?\s+(email|notice)/i);
                data.mainTitle = titleMatch ? `Read ${titleMatch[0].includes('email') ? 'an email' : 'a notice'}.` : titleLine;
                data.type = titleMatch[1].toLowerCase();
            }

            // 2. 【주제 / 핵심 내용】 파싱
            const topicLine = lines.find(l => /【/.test(l));
            if (topicLine) {
                data.topicLabel = topicLine;
                const topicMatch = topicLine.match(/주제:\s*(.+?)\s*[\/\\]\s*핵심\s*내용:\s*(.+?)\s*】/);
                if (topicMatch) {
                    data.topic = topicMatch[1].trim();
                    data.coreContent = topicMatch[2].trim();
                }
            }

            // 3. 정답키 파싱: ✅ 정답: 1번 X / 2번 Y
            const answerLine = lines.find(l => /정답/.test(l) && /[1-2]번/.test(l));
            if (answerLine) {
                data.answerKey = {};
                const q1Match = answerLine.match(/1번\s*([A-Da-d])/);
                const q2Match = answerLine.match(/2번\s*([A-Da-d])/);
                if (q1Match) data.answerKey.q1 = q1Match[1].toUpperCase();
                if (q2Match) data.answerKey.q2 = q2Match[1].toUpperCase();
            }

            // 4. Questions 영역 찾기
            const questionsIdx = lines.findIndex(l => /^Questions?\s*$/i.test(l));

            // 5. 지문 파싱 (대제목/주제라벨 이후 ~ Questions 이전)
            let passageStart = 0;
            for (let i = 0; i < lines.length; i++) {
                const l = lines[i];
                if (/Read an?\s+(email|notice)/i.test(l)) { passageStart = i + 1; continue; }
                if (/【/.test(l)) { passageStart = i + 1; continue; }
                if (/^\[?세트\s*\d+\]?/.test(l)) { passageStart = i + 1; continue; }
            }

            const passageEnd = questionsIdx > 0 ? questionsIdx : lines.length;
            const passageLines = [];
            for (let i = passageStart; i < passageEnd; i++) {
                const l = lines[i];
                if (!l) continue;
                if (/^Questions?\s*$/i.test(l)) break;
                if (/정답/.test(l) && /[1-2]번/.test(l)) continue;
                passageLines.push(l);
            }
            data.passage = passageLines.join('\n');

            // 지문 단어 수 (헤더 제외)
            const bodyLines = passageLines.filter(l => {
                return !/^(To|From|Date|Subject)\s*:/i.test(l);
            });
            const bodyText = bodyLines.join(' ').replace(/[,.:;!?()]/g, ' ');
            data.passageWordCount = bodyText.split(/\s+/).filter(w => w.length > 0).length;

            // 이메일 헤더 파싱
            for (const l of passageLines) {
                const headerMatch = l.match(/^(To|From|Date|Subject)\s*:\s*(.+)/i);
                if (headerMatch) {
                    data.headers[headerMatch[1].toLowerCase()] = headerMatch[2].trim();
                }
            }

            // 6. 문항 파싱
            const questionPattern = /(?:^|\n)\s*(?:Q?\d+[\.\):]?\s*|(?:\d+[\.\)]\s*))(.+?\?)\s*/g;
            const optionPattern = /\(([A-D])\)\s*(.+?)(?=\s*\([A-D]\)|$)/g;

            // 정답키 줄의 인덱스
            const answerLineIdx = lines.findIndex(l => /정답/.test(l) && /[1-2]번/.test(l));

            // Questions 이후 ~ 정답키 이전의 텍스트에서 문항 추출
            const qStart = questionsIdx >= 0 ? questionsIdx + 1 : passageEnd;
            const qEnd = answerLineIdx >= 0 ? answerLineIdx : lines.length;
            const qText = lines.slice(qStart, qEnd).join('\n');

            // 물음표로 끝나는 줄 = 질문
            const qLines = [];
            const allQLines = lines.slice(qStart, qEnd);
            for (let i = 0; i < allQLines.length; i++) {
                if (/\?\s*$/.test(allQLines[i])) {
                    qLines.push({ qIdx: i, question: allQLines[i].replace(/^[\d.)\s:Q]+/, '').trim() });
                }
            }

            // 각 질문에 대해 보기 추출
            for (let qi = 0; qi < qLines.length; qi++) {
                const qInfo = qLines[qi];
                const nextQIdx = qi + 1 < qLines.length ? qLines[qi + 1].qIdx : allQLines.length;
                const optionText = allQLines.slice(qInfo.qIdx + 1, nextQIdx).join(' ');

                const options = [];
                let optMatch;
                const optRegex = /\(([A-D])\)\s*(.+?)(?=\s*\([A-D]\)|$)/g;
                while ((optMatch = optRegex.exec(optionText)) !== null) {
                    options.push({ letter: optMatch[1], text: optMatch[2].trim() });
                }

                // 보기가 질문과 같은 줄에 있을 수도 있음
                if (options.length === 0) {
                    const fullText = allQLines.slice(qInfo.qIdx, nextQIdx).join(' ');
                    while ((optMatch = optRegex.exec(fullText)) !== null) {
                        options.push({ letter: optMatch[1], text: optMatch[2].trim() });
                    }
                }

                data.questions.push({
                    question: qInfo.question,
                    options: options
                });
            }

            return data;

        } catch (e) {
            return { error: `파싱 오류: ${e.message}`, setNum: setNum };
        }
    },

    // ============================================
    // 개별 검증 규칙들
    // ============================================

    /** "Read an email." 또는 "Read a notice." 존재 */
    checkMainTitle(parsed, setNum) {
        if (!parsed.mainTitle) {
            return { fail: true, message: `[세트${setNum}] "Read an email." 또는 "Read a notice." 제목이 없음` };
        }
        return {};
    },

    /** 【주제 / 핵심 내용】 라벨 존재 */
    checkTopicLabel(parsed, setNum) {
        if (!parsed.topicLabel) {
            return { fail: true, message: `[세트${setNum}] 【주제 / 핵심 내용】 라벨이 없음` };
        }
        if (!parsed.topic) {
            return { fail: true, message: `[세트${setNum}] 주제 키워드를 파싱할 수 없음` };
        }
        if (!parsed.coreContent) {
            return { fail: true, message: `[세트${setNum}] 핵심 내용을 파싱할 수 없음` };
        }
        return {};
    },

    /** 이메일이면 To/From/Date/Subject 헤더 존재 */
    checkEmailHeaders(parsed, setNum) {
        if (parsed.type !== 'email') return {};

        const required = ['to', 'from', 'date', 'subject'];
        const missing = required.filter(h => !parsed.headers[h]);
        if (missing.length > 0) {
            return { fail: true, message: `[세트${setNum}] 이메일 헤더 누락: ${missing.join(', ')}` };
        }
        return {};
    },

    /** 지문 길이 50~90 단어 */
    checkPassageWordCount(parsed, setNum) {
        const count = parsed.passageWordCount;
        if (count < 50 || count > 90) {
            return { fail: true, message: `[세트${setNum}] 지문 단어 수 ${count}개 (50~90 범위여야 함)` };
        }
        return {};
    },

    /** Questions 섹션 존재 확인 */
    checkQuestionsExist(parsed, setNum) {
        if (parsed.questions.length === 0) {
            return { fail: true, message: `[세트${setNum}] 문항을 찾을 수 없음 (Questions 섹션 확인)` };
        }
        return {};
    },

    /** 문항 2개 */
    checkQuestionCount(parsed, setNum) {
        const count = parsed.questions.length;
        if (count !== 2) {
            return { fail: true, message: `[세트${setNum}] 문항 ${count}개 (2개여야 함)` };
        }
        return {};
    },

    /** 각 문항 보기 4개 (A~D) */
    checkOptionsCount(parsed, setNum) {
        for (let i = 0; i < parsed.questions.length; i++) {
            const q = parsed.questions[i];
            const optCount = q.options.length;
            if (optCount !== 4) {
                return { fail: true, message: `[세트${setNum}] Q${i + 1} 보기 ${optCount}개 (4개여야 함)` };
            }
            // A~D 존재 확인
            const letters = q.options.map(o => o.letter);
            for (const l of ['A', 'B', 'C', 'D']) {
                if (!letters.includes(l)) {
                    return { fail: true, message: `[세트${setNum}] Q${i + 1} 보기 (${l}) 누락` };
                }
            }
        }
        return {};
    },

    /** 정답키 존재 */
    checkAnswerKeyExists(parsed, setNum) {
        if (!parsed.answerKey) {
            return { fail: true, message: `[세트${setNum}] 정답키 "✅ 정답: 1번 X / 2번 X" 형식을 찾을 수 없음` };
        }
        if (!parsed.answerKey.q1) {
            return { fail: true, message: `[세트${setNum}] 1번 정답을 파싱할 수 없음` };
        }
        if (!parsed.answerKey.q2) {
            return { fail: true, message: `[세트${setNum}] 2번 정답을 파싱할 수 없음` };
        }
        return {};
    },

    /** 정답이 A~D 범위 */
    checkAnswerKeyValid(parsed, setNum) {
        if (!parsed.answerKey) return {};
        const valid = ['A', 'B', 'C', 'D'];
        if (parsed.answerKey.q1 && !valid.includes(parsed.answerKey.q1)) {
            return { fail: true, message: `[세트${setNum}] 1번 정답 "${parsed.answerKey.q1}"이 A~D 범위 밖` };
        }
        if (parsed.answerKey.q2 && !valid.includes(parsed.answerKey.q2)) {
            return { fail: true, message: `[세트${setNum}] 2번 정답 "${parsed.answerKey.q2}"이 A~D 범위 밖` };
        }
        return {};
    },

    /** 금칙어/금칙구문 */
    checkForbiddenWords(parsed, setNum) {
        if (!parsed.passage) return {};
        const text = parsed.passage.toLowerCase();

        const forbidden = [
            "in today's world", "it is crucial to", "it is important to",
            "delve into", "comprehensive",
            "don't miss out", "life-changing opportunity"
        ];

        for (const phrase of forbidden) {
            if (text.includes(phrase)) {
                return { fail: true, message: `[세트${setNum}] 금칙구문 발견: "${phrase}"` };
            }
        }

        return {};
    },

    /** 이모지 사용 금지 (정답키의 ✅ 제외) */
    checkNoEmoji(parsed, setNum) {
        if (!parsed.passage) return {};
        // 이모지 범위 (✅ 제외)
        const emojiPattern = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
        if (emojiPattern.test(parsed.passage)) {
            return { fail: true, message: `[세트${setNum}] 지문에 이모지 사용 금지` };
        }
        return {};
    },

    /** 제외목록 주제 확인 */
    checkExcludedTopics(parsed, setNum) {
        if (!parsed.topic) return {};
        const topic = parsed.topic.toLowerCase();

        const excluded = [
            { topic: 'conference registration', content: '등록 확인' },
            { topic: 'building access hours', content: '운영 시간 변경' },
            { topic: 'dental appointment', content: '예약 확인' },
            { topic: 'recycling program', content: '분리수거 규정 변경' },
        ];

        for (const ex of excluded) {
            if (topic.includes(ex.topic.toLowerCase().split(' ')[0]) &&
                topic.includes(ex.topic.toLowerCase().split(' ').slice(-1)[0])) {
                return { fail: true, message: `[세트${setNum}] 제외목록 주제 "${ex.topic}" 와 유사` };
            }
        }

        return {};
    },

    /** 다중 세트 간 주제 중복 확인 */
    checkCrossSetDuplicate(parsedSets) {
        const topics = parsedSets.filter(s => s.topic).map(s => s.topic.toLowerCase());
        const unique = new Set(topics);
        if (unique.size < topics.length) {
            return { fail: true, message: '세트 간 주제 중복 발견' };
        }
        return {};
    },
};

// 모듈로 내보내기 (브라우저 환경)
window.Daily1GenerationValidator = Daily1GenerationValidator;
