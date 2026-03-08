/* ============================================
   Daily1 (Read an email/notice) 해설프롬 검증 규칙
   - ===태그=== 구분자 형식 검증
   - Supabase tr_reading_daily1 컬럼 매핑 검증
   ============================================ */

const Daily1ExplanationValidator = {

    // 필수 태그 목록 (순서대로)
    REQUIRED_TAGS: [
        'MAIN_TITLE',
        'PASSAGE_TITLE',
        'PASSAGE_CONTENT',
        'SENTENCE_TRANSLATIONS',
        'INTERACTIVE_WORDS',
        'QUESTION1',
        'QUESTION2'
    ],

    /**
     * 메인 검증 함수
     * @param {string} rawOutput - 해설프롬 출력물 전체 텍스트
     * @returns {object} { pass: boolean, errors: [], warnings: [], parsed: {} }
     */
    validate(rawOutput) {
        const result = {
            pass: true,
            errors: [],
            warnings: [],
            parsed: {}
        };

        // 1. 태그 파싱
        const parsed = this.parse(rawOutput);
        result.parsed = parsed;

        if (parsed.error) {
            result.pass = false;
            result.errors.push(parsed.error);
            return result;
        }

        // 2. 검증 규칙 순차 실행
        const checks = [
            this.checkAllTagsExist,
            this.checkNoExtraTags,
            this.checkMainTitle,
            this.checkPassageTitle,
            this.checkPassageContent,
            this.checkPassageContentDelimiters,
            this.checkSentenceTranslations,
            this.checkSentenceTranslationsNoEnglish,
            this.checkInteractiveWords,
            this.checkInteractiveWordsFormat,
            this.checkQuestion1,
            this.checkQuestion1Format,
            this.checkQuestion2,
            this.checkQuestion2Format,
            this.checkAnswerNumberValid,
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
     * ===태그=== 형식 파싱
     */
    parse(rawOutput) {
        const data = {
            tags: {},           // {TAG_NAME: content}
            foundTags: [],      // 발견된 태그 순서
            mainTitle: null,
            passageTitle: null,
            passageContent: null,
            sentenceTranslations: null,
            interactiveWords: [],
            question1: null,
            question2: null,
            // Supabase 매핑용
            supabaseData: {},
        };

        try {
            const text = rawOutput.trim();

            // ===TAG=== 패턴으로 섹션 분리
            const tagPattern = /===([A-Z0-9_]+)===/g;
            const tagMatches = [...text.matchAll(tagPattern)];

            if (tagMatches.length === 0) {
                return { error: '파싱 실패: ===TAG=== 형식의 태그를 찾을 수 없습니다.' };
            }

            // 각 태그의 내용 추출
            for (let i = 0; i < tagMatches.length; i++) {
                const tagName = tagMatches[i][1];
                const contentStart = tagMatches[i].index + tagMatches[i][0].length;
                const contentEnd = i + 1 < tagMatches.length ? tagMatches[i + 1].index : text.length;
                const content = text.substring(contentStart, contentEnd).trim();

                data.tags[tagName] = content;
                data.foundTags.push(tagName);
            }

            // 개별 필드 파싱
            data.mainTitle = data.tags['MAIN_TITLE'] || null;
            data.passageTitle = data.tags['PASSAGE_TITLE'] || null;
            data.passageContent = data.tags['PASSAGE_CONTENT'] || null;
            data.sentenceTranslations = data.tags['SENTENCE_TRANSLATIONS'] || null;

            // 어휘 파싱 (표현::뜻::설명 ## 구분)
            if (data.tags['INTERACTIVE_WORDS']) {
                const items = data.tags['INTERACTIVE_WORDS'].split('##').filter(s => s.trim());
                data.interactiveWords = items.map(item => {
                    const parts = item.split('::').map(p => p.trim());
                    return {
                        expression: parts[0] || '',
                        meaning: parts[1] || '',
                        explanation: parts[2] || '',
                    };
                });
            }

            // 문항 파싱
            data.question1 = this.parseQuestion(data.tags['QUESTION1']);
            data.question2 = this.parseQuestion(data.tags['QUESTION2']);

            // Supabase 매핑 데이터 생성
            data.supabaseData = this.buildSupabaseData(data);

            return data;

        } catch (e) {
            return { error: `파싱 오류: ${e.message}` };
        }
    },

    /**
     * 문항 파싱 (Q1::질문::해석::정답번호::보기들)
     */
    parseQuestion(raw) {
        if (!raw) return null;

        const parts = raw.split('::');
        if (parts.length < 5) {
            return { error: `:: 구분자 부족 (${parts.length - 1}개, 최소 4개 필요)`, raw: raw };
        }

        const qLabel = parts[0].trim();           // Q1 또는 Q2
        const questionEn = parts[1].trim();        // 영어 질문
        const questionKo = parts[2].trim();        // 한글 해석
        const answerNum = parseInt(parts[3].trim()); // 정답번호 (1=A, 2=B, 3=C, 4=D)

        // 나머지 부분을 다시 합침 (보기 안에 :: 가 있으므로)
        const optionsRaw = parts.slice(4).join('::');

        // 보기 파싱: A)텍스트::해석::해설##B)텍스트::해석::해설...
        const optionItems = optionsRaw.split('##').filter(s => s.trim());
        const options = optionItems.map(item => {
            const optParts = item.split('::').map(p => p.trim());
            const letterMatch = optParts[0]?.match(/^([A-D])\)\s*(.+)/);
            return {
                letter: letterMatch ? letterMatch[1] : '',
                textEn: letterMatch ? letterMatch[2] : optParts[0] || '',
                textKo: optParts[1] || '',
                explanation: optParts[2] || '',
                raw: item,
            };
        });

        return {
            label: qLabel,
            questionEn: questionEn,
            questionKo: questionKo,
            answerNum: answerNum,
            answerLetter: ['', 'A', 'B', 'C', 'D'][answerNum] || '',
            options: options,
            raw: raw,
        };
    },

    /**
     * Supabase 컬럼 데이터 빌드
     */
    buildSupabaseData(data) {
        const result = {};

        result.main_title = data.mainTitle || '';
        result.passage_title = data.passageTitle || '';
        result.passage_content = data.passageContent || '';
        result.sentence_translations = data.sentenceTranslations || '';

        // interactive_words: 표현::뜻::설명##표현::뜻::설명
        if (data.interactiveWords.length > 0) {
            result.interactive_words = data.interactiveWords
                .map(w => `${w.expression}::${w.meaning}::${w.explanation}`)
                .join('##');
        } else {
            result.interactive_words = '';
        }

        // question1, question2: 원본 그대로
        result.question1 = data.tags['QUESTION1'] || '';
        result.question2 = data.tags['QUESTION2'] || '';

        return result;
    },

    // ============================================
    // 개별 검증 규칙들
    // ============================================

    /** 필수 태그 7개 모두 존재 */
    checkAllTagsExist(parsed) {
        const missing = this.REQUIRED_TAGS.filter(t => !parsed.tags[t]);
        if (missing.length > 0) {
            return { fail: true, message: `필수 태그 누락: ${missing.map(t => '===' + t + '===').join(', ')}` };
        }
        return {};
    },

    /** 지정된 7개 태그 외 다른 태그 사용 금지 */
    checkNoExtraTags(parsed) {
        const extra = parsed.foundTags.filter(t => !this.REQUIRED_TAGS.includes(t));
        if (extra.length > 0) {
            return { fail: true, message: `허용되지 않은 태그 발견: ${extra.map(t => '===' + t + '===').join(', ')}` };
        }
        return {};
    },

    /** MAIN_TITLE 검증 */
    checkMainTitle(parsed) {
        if (!parsed.mainTitle) return {};
        if (!/Read an?\s+(email|notice)/i.test(parsed.mainTitle)) {
            return { fail: true, message: `MAIN_TITLE이 "Read an email." 또는 "Read a notice." 형식이 아님: "${parsed.mainTitle}"` };
        }
        return {};
    },

    /** PASSAGE_TITLE 비어있지 않은지 */
    checkPassageTitle(parsed) {
        if (!parsed.passageTitle || !parsed.passageTitle.trim()) {
            return { fail: true, message: 'PASSAGE_TITLE이 비어있음' };
        }
        return {};
    },

    /** PASSAGE_CONTENT 비어있지 않은지 */
    checkPassageContent(parsed) {
        if (!parsed.passageContent || !parsed.passageContent.trim()) {
            return { fail: true, message: 'PASSAGE_CONTENT가 비어있음' };
        }
        // 최소 길이 확인
        const wordCount = parsed.passageContent.replace(/[#|]/g, ' ').split(/\s+/).filter(w => w.length > 0).length;
        if (wordCount < 30) {
            return { fail: true, message: `PASSAGE_CONTENT가 너무 짧음 (${wordCount}단어)` };
        }
        return {};
    },

    /** PASSAGE_CONTENT 구분자 확인 (## 과 #|#) */
    checkPassageContentDelimiters(parsed) {
        if (!parsed.passageContent) return {};
        // ## 또는 #|# 중 하나는 있어야 함
        if (!parsed.passageContent.includes('##') && !parsed.passageContent.includes('#|#')) {
            return { fail: true, message: 'PASSAGE_CONTENT에 구분자(## 또는 #|#)가 없음' };
        }
        // #|# (문장 경계)가 최소 1개 이상
        const sentenceBoundaries = (parsed.passageContent.match(/#\|#/g) || []).length;
        if (sentenceBoundaries === 0) {
            return { warning: 'PASSAGE_CONTENT에 문장 경계 구분자(#|#)가 없음 — 문장 분리가 안 됩니다' };
        }
        return {};
    },

    /** SENTENCE_TRANSLATIONS 비어있지 않은지 */
    checkSentenceTranslations(parsed) {
        if (!parsed.sentenceTranslations || !parsed.sentenceTranslations.trim()) {
            return { fail: true, message: 'SENTENCE_TRANSLATIONS가 비어있음' };
        }
        // ## 구분자 확인
        if (!parsed.sentenceTranslations.includes('##')) {
            return { fail: true, message: 'SENTENCE_TRANSLATIONS에 ## 구분자가 없음' };
        }
        return {};
    },

    /** SENTENCE_TRANSLATIONS에 영어 섞이지 않았는지 */
    checkSentenceTranslationsNoEnglish(parsed) {
        if (!parsed.sentenceTranslations) return {};
        // 영어 단어가 3개 이상 연속으로 나오면 경고
        const englishRun = /[a-zA-Z]{3,}(\s+[a-zA-Z]{3,}){2,}/;
        if (englishRun.test(parsed.sentenceTranslations)) {
            return { warning: 'SENTENCE_TRANSLATIONS에 영어 표현이 포함된 것 같음 (순수 한글만 권장)' };
        }
        return {};
    },

    /** INTERACTIVE_WORDS 비어있지 않은지 */
    checkInteractiveWords(parsed) {
        if (parsed.interactiveWords.length === 0) {
            return { fail: true, message: 'INTERACTIVE_WORDS가 비어있음' };
        }
        if (parsed.interactiveWords.length < 3) {
            return { warning: `INTERACTIVE_WORDS 항목이 ${parsed.interactiveWords.length}개로 적음 (3개 이상 권장)` };
        }
        return {};
    },

    /** INTERACTIVE_WORDS 형식 (표현::뜻::설명) */
    checkInteractiveWordsFormat(parsed) {
        for (let i = 0; i < parsed.interactiveWords.length; i++) {
            const w = parsed.interactiveWords[i];
            if (!w.expression) {
                return { fail: true, message: `INTERACTIVE_WORDS #${i + 1} 표현이 비어있음` };
            }
            if (!w.meaning) {
                return { fail: true, message: `INTERACTIVE_WORDS #${i + 1} "${w.expression}" 뜻이 비어있음` };
            }
            if (!w.explanation) {
                return { fail: true, message: `INTERACTIVE_WORDS #${i + 1} "${w.expression}" 설명이 비어있음` };
            }
        }
        return {};
    },

    /** QUESTION1 존재 및 기본 파싱 */
    checkQuestion1(parsed) {
        if (!parsed.question1) {
            return { fail: true, message: 'QUESTION1을 파싱할 수 없음' };
        }
        if (parsed.question1.error) {
            return { fail: true, message: `QUESTION1 파싱 오류: ${parsed.question1.error}` };
        }
        return {};
    },

    /** QUESTION1 세부 형식 */
    checkQuestion1Format(parsed) {
        const q = parsed.question1;
        if (!q || q.error) return {};

        if (!q.questionEn) {
            return { fail: true, message: 'QUESTION1 영어 질문이 비어있음' };
        }
        if (!q.questionKo) {
            return { fail: true, message: 'QUESTION1 한글 해석이 비어있음' };
        }
        if (q.options.length !== 4) {
            return { fail: true, message: `QUESTION1 보기 ${q.options.length}개 (4개여야 함)` };
        }
        // 각 보기에 A~D 레터 확인
        const letters = q.options.map(o => o.letter);
        for (const l of ['A', 'B', 'C', 'D']) {
            if (!letters.includes(l)) {
                return { fail: true, message: `QUESTION1 보기 (${l}) 누락` };
            }
        }
        // 각 보기에 해설 확인
        for (const opt of q.options) {
            if (!opt.explanation) {
                return { fail: true, message: `QUESTION1 보기 (${opt.letter}) 해설이 비어있음` };
            }
        }
        return {};
    },

    /** QUESTION2 존재 및 기본 파싱 */
    checkQuestion2(parsed) {
        if (!parsed.question2) {
            return { fail: true, message: 'QUESTION2를 파싱할 수 없음' };
        }
        if (parsed.question2.error) {
            return { fail: true, message: `QUESTION2 파싱 오류: ${parsed.question2.error}` };
        }
        return {};
    },

    /** QUESTION2 세부 형식 */
    checkQuestion2Format(parsed) {
        const q = parsed.question2;
        if (!q || q.error) return {};

        if (!q.questionEn) {
            return { fail: true, message: 'QUESTION2 영어 질문이 비어있음' };
        }
        if (!q.questionKo) {
            return { fail: true, message: 'QUESTION2 한글 해석이 비어있음' };
        }
        if (q.options.length !== 4) {
            return { fail: true, message: `QUESTION2 보기 ${q.options.length}개 (4개여야 함)` };
        }
        const letters = q.options.map(o => o.letter);
        for (const l of ['A', 'B', 'C', 'D']) {
            if (!letters.includes(l)) {
                return { fail: true, message: `QUESTION2 보기 (${l}) 누락` };
            }
        }
        for (const opt of q.options) {
            if (!opt.explanation) {
                return { fail: true, message: `QUESTION2 보기 (${opt.letter}) 해설이 비어있음` };
            }
        }
        return {};
    },

    /** 정답 번호 유효성 (1~4) */
    checkAnswerNumberValid(parsed) {
        if (parsed.question1 && !parsed.question1.error) {
            const num = parsed.question1.answerNum;
            if (isNaN(num) || num < 1 || num > 4) {
                return { fail: true, message: `QUESTION1 정답번호 "${num}" 이 유효하지 않음 (1~4)` };
            }
        }
        if (parsed.question2 && !parsed.question2.error) {
            const num = parsed.question2.answerNum;
            if (isNaN(num) || num < 1 || num > 4) {
                return { fail: true, message: `QUESTION2 정답번호 "${num}" 이 유효하지 않음 (1~4)` };
            }
        }
        return {};
    },
};

// 모듈로 내보내기 (브라우저 환경)
window.Daily1ExplanationValidator = Daily1ExplanationValidator;
