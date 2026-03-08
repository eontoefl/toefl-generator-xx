/* ============================================
   TOEFL Admin - App Logic
   모듈형 구조: 검증 → 저장 파이프라인
   Step 1: 수동 붙여넣기 검증
   Step 2: AI 자동 생성 (API 연동)
   ============================================ */

document.addEventListener('DOMContentLoaded', () => {

    // ============================================
    // State
    // ============================================
    let currentGenParsed = null;  // 생성프롬 검증 통과 데이터
    let currentExpParsed = null;  // 해설프롬 검증 통과 데이터
    let currentExpRaw = null;     // 해설프롬 원본 텍스트
    let nextSetNumber = 15;       // fillblank_set_XXXX 다음 번호

    // Step 2 State
    let aiGenOutput = null;       // AI 생성프롬 출력물
    let aiExpOutput = null;       // AI 해설프롬 출력물
    let aiGenParsed = null;       // AI 생성프롬 검증 통과 데이터
    let aiExpParsed = null;       // AI 해설프롬 검증 통과 데이터
    let aiGenRawForExp = null;    // 해설프롬에 삽입할 생성 문제 원문
    let lastGenFailReasons = [];  // 마지막 생성 실패 사유 (재생성 피드백용)
    let lastExpFailReasons = [];  // 마지막 해설 실패 사유 (재생성 피드백용)
    let isGenerating = false;     // API 호출 중 상태

    // ============================================
    // Navigation (Sidebar)
    // ============================================
    const navItems = document.querySelectorAll('.nav-item');
    const stepPanels = document.querySelectorAll('.step-panel');
    const pageTitle = document.getElementById('pageTitle');
    const pageDesc = document.getElementById('pageDesc');

    const stepInfo = {
        '1': { title: '1단계: 검증 → 저장', desc: '생성프롬/해설프롬 출력물을 검증하고 Supabase에 저장합니다' },
        '2': { title: '2단계: AI 자동 생성', desc: 'Claude에게 프롬프트를 전송하여 문제를 자동으로 생성합니다' },
        '3': { title: '3단계: 자동 검증 규칙', desc: '유형별 검증 규칙을 관리하고 Pass/Fail을 자동으로 판별합니다' },
        '4': { title: '4단계: 프롬프트 편집', desc: '유형별 프롬프트를 커스터마이징하고 추가 규칙을 설정합니다' },
        'history': { title: '생성 히스토리', desc: '과거에 생성한 문제들의 기록을 확인합니다' },
        'settings': { title: '설정', desc: 'API 연결 및 시스템 설정을 관리합니다' }
    };

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const step = item.dataset.step;
            if (!step) return;
            navItems.forEach(n => n.classList.remove('active'));
            item.classList.add('active');
            stepPanels.forEach(p => p.classList.remove('active'));
            const panelId = step.match(/^\d$/) ? `step${step}` : `step${step.charAt(0).toUpperCase() + step.slice(1)}`;
            const panel = document.getElementById(panelId);
            if (panel) panel.classList.add('active');
            if (stepInfo[step]) {
                pageTitle.textContent = stepInfo[step].title;
                pageDesc.textContent = stepInfo[step].desc;
            }
            document.getElementById('sidebar').classList.remove('open');
        });
    });

    // Mobile menu
    const menuToggle = document.getElementById('menuToggle');
    const sidebar = document.getElementById('sidebar');
    menuToggle.addEventListener('click', () => sidebar.classList.toggle('open'));
    document.addEventListener('click', (e) => {
        if (window.innerWidth <= 768 && !sidebar.contains(e.target) && !menuToggle.contains(e.target)) {
            sidebar.classList.remove('open');
        }
    });

    // ============================================
    // Phase Tabs (Step 1 sub-navigation)
    // ============================================
    const phaseTabs = document.querySelectorAll('.phase-tab');
    const phasePanels = document.querySelectorAll('.phase-panel');

    phaseTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const phase = tab.dataset.phase;
            if (!phase) return;
            phaseTabs.forEach(t => {
                if (t.dataset.phase) t.classList.remove('active');
            });
            tab.classList.add('active');
            phasePanels.forEach(p => p.classList.remove('active'));
            const panel = document.getElementById(`phase${phase.charAt(0).toUpperCase() + phase.slice(1)}`);
            if (panel) panel.classList.add('active');
        });
    });

    // ============================================
    // Phase 2 Tabs (Step 2 sub-navigation)
    // ============================================
    const phase2Tabs = document.querySelectorAll('[data-phase2]');
    const phase2Panels = document.querySelectorAll('.phase2-panel');

    phase2Tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const phase = tab.dataset.phase2;
            if (!phase) return;
            phase2Tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            phase2Panels.forEach(p => p.classList.remove('active'));
            const panelMap = {
                'genPrompt': 'phase2GenPrompt',
                'genResult': 'phase2GenResult',
                'expPrompt': 'phase2ExpPrompt',
                'expResult': 'phase2ExpResult',
                'aiSave': 'phase2AiSave'
            };
            const panel = document.getElementById(panelMap[phase]);
            if (panel) panel.classList.add('active');
        });
    });

    function activatePhase2Tab(phaseName) {
        phase2Tabs.forEach(t => t.classList.remove('active'));
        phase2Panels.forEach(p => p.classList.remove('active'));
        const tab = document.querySelector(`[data-phase2="${phaseName}"]`);
        if (tab) tab.classList.add('active');
        const panelMap = {
            'genPrompt': 'phase2GenPrompt',
            'genResult': 'phase2GenResult',
            'expPrompt': 'phase2ExpPrompt',
            'expResult': 'phase2ExpResult',
            'aiSave': 'phase2AiSave'
        };
        const panel = document.getElementById(panelMap[phaseName]);
        if (panel) panel.classList.add('active');
    }

    // ============================================
    // Step 1 Phase 1: 생성프롬 검증
    // ============================================
    const btnValidateGen = document.getElementById('btnValidateGen');
    const genInput = document.getElementById('genInput');
    const genResult = document.getElementById('genResult');

    btnValidateGen.addEventListener('click', () => {
        const raw = genInput.value.trim();
        if (!raw) {
            showAlert(genResult, '출력물을 붙여넣어주세요.');
            return;
        }

        const result = FBGenerationValidator.validate(raw);
        currentGenParsed = result.pass ? result.parsed : null;
        renderValidationResult(genResult, result, 'gen');

        if (result.pass) {
            const tabs = document.querySelectorAll('.phase-tab[data-phase]');
            if (tabs[0]) tabs[0].classList.add('done');
        } else {
            const tabs = document.querySelectorAll('.phase-tab[data-phase]');
            if (tabs[0]) tabs[0].classList.remove('done');
        }
    });

    // ============================================
    // Step 1 Phase 2: 해설프롬 검증
    // ============================================
    const btnValidateExp = document.getElementById('btnValidateExp');
    const expInput = document.getElementById('expInput');
    const expResult = document.getElementById('expResult');

    btnValidateExp.addEventListener('click', () => {
        const raw = expInput.value.trim();
        if (!raw) {
            showAlert(expResult, '출력물을 붙여넣어주세요.');
            return;
        }

        const result = FBExplanationValidator.validate(raw);
        currentExpParsed = result.pass ? result.parsed : null;
        currentExpRaw = result.pass ? raw : null;
        renderValidationResult(expResult, result, 'exp');

        if (result.pass) {
            const tabs = document.querySelectorAll('.phase-tab[data-phase]');
            if (tabs[1]) tabs[1].classList.add('done');
            prepareSavePhase(raw);
        } else {
            const tabs = document.querySelectorAll('.phase-tab[data-phase]');
            if (tabs[1]) tabs[1].classList.remove('done');
        }
    });

    // ============================================
    // Step 1 Phase 3: 저장
    // ============================================
    const btnCopySQL = document.getElementById('btnCopySQL');
    const btnSupabaseSave = document.getElementById('btnSupabaseSave');

    btnCopySQL.addEventListener('click', () => {
        const sqlCode = document.getElementById('sqlCode').textContent;
        copyToClipboard(sqlCode, 'saveStatus');
    });

    btnSupabaseSave.addEventListener('click', async () => {
        await supabaseInsert('saveId', currentExpRaw, 'btnSupabaseSave', 'saveStatus');
    });

    // ============================================
    // Step 2: AI 자동 생성 - 전체 파이프라인
    // ============================================

    // --- Phase 1: 생성프롬 입력 → 생성 요청 ---
    const btnAiGenerate = document.getElementById('btnAiGenerate');
    const aiGenPromptEl = document.getElementById('aiGenPrompt');

    btnAiGenerate.addEventListener('click', async () => {
        const prompt = aiGenPromptEl.value.trim();
        if (!prompt) {
            showToast('생성프롬프트를 입력해주세요.', 'error');
            return;
        }
        await runGeneration(prompt, false);
    });

    async function runGeneration(prompt, isRetry) {
        if (isGenerating) return;
        isGenerating = true;

        const loading = document.getElementById('aiGenLoading');
        const outputEl = document.getElementById('aiGenOutput');
        const resultEl = document.getElementById('aiGenValidation');

        // 로딩 표시
        btnAiGenerate.disabled = true;
        btnAiGenerate.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 생성 중...';
        loading.style.display = 'flex';

        // 피드백 포함 프롬프트 (재생성 시)
        let finalPrompt = prompt;
        if (isRetry && lastGenFailReasons.length > 0) {
            finalPrompt += `\n\n[재생성 피드백]\n이전 생성에서 다음 오류가 발견되었습니다. 반드시 수정해주세요:\n${lastGenFailReasons.map((r, i) => `${i + 1}. ${r}`).join('\n')}`;
        }

        try {
            const apiEndpoint = getApiEndpoint();
            const response = await fetch(apiEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt: finalPrompt,
                    system: '당신은 표준 영어 시험 문제 출제 전문가입니다. 주어진 규칙을 정확히 따라 문제를 생성하세요.'
                })
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error || `API 오류 (${response.status})`);
            }

            const data = await response.json();
            aiGenOutput = data.content;

            // 출력물 표시 & Phase 2로 이동
            outputEl.value = aiGenOutput;
            activatePhase2Tab('genResult');
            markPhase2TabDone('genPrompt');

            // 사용량 표시
            if (data.usage) {
                updateUsageDisplay(data.usage, data.model);
            }

            // 자동 검증
            const valResult = FBGenerationValidator.validate(aiGenOutput);
            aiGenParsed = valResult.pass ? valResult.parsed : null;
            renderAiValidationResult(resultEl, valResult, 'gen');

            if (valResult.pass) {
                markPhase2TabDone('genResult');
                // 생성 문제를 해설 프롬프트 영역에 자동 삽입
                aiGenRawForExp = extractPassageSection(aiGenOutput);
                document.getElementById('aiExpProblem').value = aiGenRawForExp;
                lastGenFailReasons = [];
                // 파이프라인 상태 업데이트
                updatePipelineStatus('expReady');
            } else {
                lastGenFailReasons = valResult.errors;
                markPhase2TabFail('genResult');
            }

        } catch (error) {
            resultEl.innerHTML = renderErrorBanner(`API 호출 실패: ${error.message}`);
        } finally {
            isGenerating = false;
            loading.style.display = 'none';
            btnAiGenerate.disabled = false;
            btnAiGenerate.innerHTML = '<i class="fas fa-paper-plane"></i> Claude에게 문제 생성 요청';
        }
    }

    // --- Phase 3: 해설프롬 입력 → 생성 요청 ---
    const btnAiExplain = document.getElementById('btnAiExplain');
    const aiExpPromptEl = document.getElementById('aiExpPrompt');

    btnAiExplain.addEventListener('click', async () => {
        const prompt = aiExpPromptEl.value.trim();
        if (!prompt) {
            showToast('해설프롬프트를 입력해주세요.', 'error');
            return;
        }
        if (!aiGenRawForExp) {
            showToast('먼저 생성프롬에서 문제를 생성해주세요.', 'error');
            return;
        }
        await runExplanation(prompt, false);
    });

    async function runExplanation(prompt, isRetry) {
        if (isGenerating) return;
        isGenerating = true;

        const loading = document.getElementById('aiExpLoading');
        const outputEl = document.getElementById('aiExpOutput');
        const resultEl = document.getElementById('aiExpValidation');

        btnAiExplain.disabled = true;
        btnAiExplain.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 생성 중...';
        loading.style.display = 'flex';

        // 문제 원문을 해설프롬 끝에 삽입
        let finalPrompt = prompt + `\n\n<문제>\n${aiGenRawForExp}\n</문제>`;

        // 재생성 피드백 삽입
        if (isRetry && lastExpFailReasons.length > 0) {
            finalPrompt += `\n\n[재생성 피드백]\n이전 해설에서 다음 오류가 발견되었습니다. 반드시 수정해주세요:\n${lastExpFailReasons.map((r, i) => `${i + 1}. ${r}`).join('\n')}`;
        }

        try {
            const apiEndpoint = getApiEndpoint();
            const response = await fetch(apiEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt: finalPrompt,
                    system: '당신은 TOEFL 전문 강사입니다. 주어진 규칙에 따라 문제 해설을 생성하세요. 반드시 지정된 {{}} 마커 형식을 사용하세요.'
                })
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error || `API 오류 (${response.status})`);
            }

            const data = await response.json();
            aiExpOutput = data.content;

            // 출력물 표시 & Phase 4로 이동
            outputEl.value = aiExpOutput;
            activatePhase2Tab('expResult');
            markPhase2TabDone('expPrompt');

            if (data.usage) {
                updateUsageDisplay(data.usage, data.model);
            }

            // 자동 검증
            const valResult = FBExplanationValidator.validate(aiExpOutput);
            aiExpParsed = valResult.pass ? valResult.parsed : null;
            renderAiValidationResult(resultEl, valResult, 'exp');

            if (valResult.pass) {
                markPhase2TabDone('expResult');
                lastExpFailReasons = [];
                // 저장 Phase 준비
                prepareAiSavePhase(aiExpOutput);
                updatePipelineStatus('saveReady');
            } else {
                lastExpFailReasons = valResult.errors;
                markPhase2TabFail('expResult');
            }

        } catch (error) {
            resultEl.innerHTML = renderErrorBanner(`API 호출 실패: ${error.message}`);
        } finally {
            isGenerating = false;
            loading.style.display = 'none';
            btnAiExplain.disabled = false;
            btnAiExplain.innerHTML = '<i class="fas fa-paper-plane"></i> Claude에게 해설 생성 요청';
        }
    }

    // --- Phase 5: 저장 ---
    const btnAiCopySQL = document.getElementById('btnAiCopySQL');
    const btnAiSupabaseSave = document.getElementById('btnAiSupabaseSave');

    btnAiCopySQL.addEventListener('click', () => {
        const sqlCode = document.getElementById('aiSqlCode').textContent;
        copyToClipboard(sqlCode, 'aiSaveStatus');
    });

    btnAiSupabaseSave.addEventListener('click', async () => {
        await supabaseInsert('aiSaveId', aiExpOutput, 'btnAiSupabaseSave', 'aiSaveStatus');
    });

    // ============================================
    // AI Helper Functions
    // ============================================

    function getApiEndpoint() {
        const saved = localStorage.getItem('ai_api_endpoint');
        if (saved && saved.trim()) return saved.trim();
        // 기본값: 같은 도메인의 /api/generate
        return '/api/generate';
    }

    function extractPassageSection(rawOutput) {
        // 생성프롬 출력물에서 지문 + 정답 + 매핑 전체를 추출
        // 해설프롬에 전달할 형태
        return rawOutput.trim();
    }

    function updateUsageDisplay(usage, model) {
        const el = document.getElementById('aiUsageInfo');
        if (!el) return;
        const inputTokens = usage.input_tokens || 0;
        const outputTokens = usage.output_tokens || 0;
        el.innerHTML = `
            <div class="usage-item"><span class="usage-label">모델</span><span class="usage-val">${model || '-'}</span></div>
            <div class="usage-item"><span class="usage-label">입력</span><span class="usage-val">${inputTokens.toLocaleString()} tokens</span></div>
            <div class="usage-item"><span class="usage-label">출력</span><span class="usage-val">${outputTokens.toLocaleString()} tokens</span></div>
        `;
        el.style.display = 'block';
    }

    function updatePipelineStatus(status) {
        const steps = document.querySelectorAll('.pipeline-step');
        if (!steps.length) return;

        if (status === 'expReady') {
            steps[0]?.classList.add('done');
            steps[0]?.classList.remove('active');
            steps[1]?.classList.add('active');
            steps[1]?.classList.remove('done');
        } else if (status === 'saveReady') {
            steps[0]?.classList.add('done');
            steps[0]?.classList.remove('active');
            steps[1]?.classList.add('done');
            steps[1]?.classList.remove('active');
            steps[2]?.classList.add('active');
        }
    }

    function markPhase2TabDone(phaseName) {
        const tab = document.querySelector(`[data-phase2="${phaseName}"]`);
        if (tab) {
            tab.classList.remove('fail');
            tab.classList.add('done');
        }
    }

    function markPhase2TabFail(phaseName) {
        const tab = document.querySelector(`[data-phase2="${phaseName}"]`);
        if (tab) {
            tab.classList.remove('done');
            tab.classList.add('fail');
        }
    }

    function prepareAiSavePhase(passageText) {
        const id = `fillblank_set_${String(nextSetNumber).padStart(4, '0')}`;
        document.getElementById('aiSaveId').value = id;

        const preview = document.getElementById('aiSavePreview');
        const truncated = passageText.length > 500 ? passageText.substring(0, 500) + '...' : passageText;
        preview.innerHTML = `<pre style="white-space:pre-wrap; word-break:break-all; font-size:11px; color:var(--accent-green); font-family:'Fira Code',monospace;">${escapeHtml(truncated)}</pre>`;

        const escapedText = passageText.replace(/'/g, "''");
        const sql = `INSERT INTO tr_reading_fillblanks (id, passage_with_markers)\nVALUES ('${id}', '${escapedText}');`;
        document.getElementById('aiSqlCode').textContent = sql;

        const supabaseUrl = localStorage.getItem('supabase_url');
        const supabaseKey = localStorage.getItem('supabase_anon_key');
        document.getElementById('btnAiSupabaseSave').disabled = !(supabaseUrl && supabaseKey);
    }

    function renderAiValidationResult(container, result, type) {
        let html = '';

        // Banner
        if (result.pass) {
            html += `<div class="result-banner pass">
                <i class="fas fa-check-circle"></i>
                <span>PASS — 검증 통과</span>
            </div>`;
        } else {
            html += `<div class="result-banner fail">
                <i class="fas fa-times-circle"></i>
                <span>FAIL — ${result.errors.length}개 오류 발견</span>
            </div>`;
        }

        // Errors
        if (result.errors.length > 0) {
            html += `<div class="result-errors"><h4><i class="fas fa-xmark"></i> 오류 (${result.errors.length})</h4>`;
            for (const err of result.errors) {
                html += `<div class="error-item"><i class="fas fa-circle"></i><span>${escapeHtml(err)}</span></div>`;
            }
            html += `</div>`;
        }

        // Warnings
        if (result.warnings && result.warnings.length > 0) {
            html += `<div class="result-warnings"><h4><i class="fas fa-triangle-exclamation"></i> 경고 (${result.warnings.length})</h4>`;
            for (const warn of result.warnings) {
                html += `<div class="warning-item"><i class="fas fa-circle"></i><span>${escapeHtml(warn)}</span></div>`;
            }
            html += `</div>`;
        }

        // Parsed summary (생성프롬)
        if (type === 'gen' && result.parsed && !result.parsed.error) {
            const p = result.parsed;
            html += `<div class="parsed-summary">
                <h4>파싱 요약</h4>
                <div class="summary-grid">
                    <div class="summary-item"><div class="val">${p.blanks?.length || 0}</div><div class="label">결손 토큰</div></div>
                    <div class="summary-item"><div class="val">${p.answers?.length || 0}</div><div class="label">정답</div></div>
                    <div class="summary-item"><div class="val">${p.mappings?.length || 0}</div><div class="label">매핑</div></div>
                    <div class="summary-item"><div class="val">${p.wordCount || 0}</div><div class="label">단어 수</div></div>
                    <div class="summary-item"><div class="val">${p.sentences?.length || 0}</div><div class="label">문장 수</div></div>
                </div>`;
            if (p.mappings && p.mappings.length > 0) {
                html += `<table class="marker-table" style="margin-top:12px;">
                    <tr><th>#</th><th>토큰</th><th>정답</th><th>완성 단어</th></tr>`;
                for (const m of p.mappings) {
                    const completed = m.token.replace(/_[\s_]*/g, '') + m.answer;
                    html += `<tr>
                        <td>${m.num}</td>
                        <td>${escapeHtml(m.token)}</td>
                        <td>${escapeHtml(m.answer)}</td>
                        <td><span class="marker-word">${escapeHtml(completed)}</span></td>
                    </tr>`;
                }
                html += `</table>`;
            }
            html += `</div>`;
        }

        // Parsed summary (해설프롬)
        if (type === 'exp' && result.parsed && !result.parsed.error) {
            const p = result.parsed;
            html += `<div class="parsed-summary">
                <h4>마커 요약</h4>
                <div class="summary-grid">
                    <div class="summary-item"><div class="val">${p.markers?.length || 0}</div><div class="label">마커 수</div></div>
                    <div class="summary-item"><div class="val">${p.markers?.filter(m => m.hasWrongAnswer).length || 0}</div><div class="label">오답 포함</div></div>
                </div>`;
            if (p.markers && p.markers.length > 0) {
                html += `<table class="marker-table" style="margin-top:12px;">
                    <tr><th>#</th><th>완성 단어</th><th>해설 길이</th><th>오답</th></tr>`;
                for (const m of p.markers) {
                    html += `<tr>
                        <td>${m.index}</td>
                        <td><span class="marker-word">${escapeHtml(m.completedWord)}</span></td>
                        <td>${m.explanation.length}자</td>
                        <td>${m.hasWrongAnswer ? `<span class="marker-has-wrong">${escapeHtml(m.wrongAnswer)}</span>` : '-'}</td>
                    </tr>`;
                }
                html += `</table>`;
            }
            html += `</div>`;
        }

        // Action buttons based on result
        if (result.pass) {
            if (type === 'gen') {
                html += `<button class="btn btn-success btn-full" style="margin-top:16px;" id="btnGoToExpPrompt">
                    <i class="fas fa-arrow-right"></i> 다음: 해설프롬 단계로 이동
                </button>`;
            } else if (type === 'exp') {
                html += `<button class="btn btn-success btn-full" style="margin-top:16px;" id="btnGoToAiSave">
                    <i class="fas fa-arrow-right"></i> 다음: 저장 단계로 이동
                </button>`;
            }
        } else {
            // Fail: 재생성 버튼 + 강제 진행 버튼
            if (type === 'gen') {
                html += `<div class="retry-section">
                    <div class="retry-info">
                        <i class="fas fa-rotate"></i>
                        <span>위 오류 사유가 피드백으로 Claude에게 전달됩니다</span>
                    </div>
                    <button class="btn btn-warning btn-full" id="btnRetryGen">
                        <i class="fas fa-rotate-right"></i> 피드백 포함 재생성
                    </button>
                    <button class="btn btn-ghost btn-full force-proceed-btn" id="btnForceGen">
                        <i class="fas fa-forward"></i> 오류 무시하고 해설 단계로 강제 진행
                    </button>
                </div>`;
            } else if (type === 'exp') {
                html += `<div class="retry-section">
                    <div class="retry-info">
                        <i class="fas fa-rotate"></i>
                        <span>위 오류 사유가 피드백으로 Claude에게 전달됩니다</span>
                    </div>
                    <button class="btn btn-warning btn-full" id="btnRetryExp">
                        <i class="fas fa-rotate-right"></i> 피드백 포함 재생성
                    </button>
                    <button class="btn btn-ghost btn-full force-proceed-btn" id="btnForceExp">
                        <i class="fas fa-forward"></i> 오류 무시하고 저장 단계로 강제 진행
                    </button>
                </div>`;
            }
        }

        container.innerHTML = html;

        // 동적 버튼 이벤트 바인딩
        const btnGoToExp = document.getElementById('btnGoToExpPrompt');
        if (btnGoToExp) {
            btnGoToExp.addEventListener('click', () => activatePhase2Tab('expPrompt'));
        }

        const btnGoToSave = document.getElementById('btnGoToAiSave');
        if (btnGoToSave) {
            btnGoToSave.addEventListener('click', () => activatePhase2Tab('aiSave'));
        }

        const btnRetryGen = document.getElementById('btnRetryGen');
        if (btnRetryGen) {
            btnRetryGen.addEventListener('click', () => {
                const prompt = aiGenPromptEl.value.trim();
                if (prompt) runGeneration(prompt, true);
            });
        }

        const btnRetryExp = document.getElementById('btnRetryExp');
        if (btnRetryExp) {
            btnRetryExp.addEventListener('click', () => {
                const prompt = aiExpPromptEl.value.trim();
                if (prompt) runExplanation(prompt, true);
            });
        }

        // 강제 진행 버튼
        const btnForceGen = document.getElementById('btnForceGen');
        if (btnForceGen) {
            btnForceGen.addEventListener('click', () => {
                aiGenRawForExp = extractPassageSection(aiGenOutput);
                document.getElementById('aiExpProblem').value = aiGenRawForExp;
                markPhase2TabDone('genResult');
                updatePipelineStatus('expReady');
                activatePhase2Tab('expPrompt');
                showToast('강제 진행: 해설 단계로 이동합니다', 'success');
            });
        }

        const btnForceExp = document.getElementById('btnForceExp');
        if (btnForceExp) {
            btnForceExp.addEventListener('click', () => {
                markPhase2TabDone('expResult');
                prepareAiSavePhase(aiExpOutput);
                updatePipelineStatus('saveReady');
                activatePhase2Tab('aiSave');
                showToast('강제 진행: 저장 단계로 이동합니다', 'success');
            });
        }
    }

    function renderErrorBanner(message) {
        return `<div class="result-banner fail">
            <i class="fas fa-exclamation-triangle"></i>
            <span>${escapeHtml(message)}</span>
        </div>
        <div class="api-error-help">
            <h4><i class="fas fa-wrench"></i> 확인 사항</h4>
            <ul>
                <li>설정 페이지에서 AI API Endpoint가 올바른지 확인하세요</li>
                <li>Vercel 환경변수에 <code>ANTHROPIC_API_KEY</code>가 설정되었는지 확인하세요</li>
                <li>Anthropic 계정에 크레딧이 충전되어 있는지 확인하세요</li>
            </ul>
        </div>`;
    }

    // ============================================
    // Step 1 Helper Functions
    // ============================================

    function prepareSavePhase(passageText) {
        const id = `fillblank_set_${String(nextSetNumber).padStart(4, '0')}`;
        document.getElementById('saveId').value = id;

        const preview = document.getElementById('savePreview');
        const truncated = passageText.length > 500 ? passageText.substring(0, 500) + '...' : passageText;
        preview.innerHTML = `<pre style="white-space:pre-wrap; word-break:break-all; font-size:11px; color:var(--accent-green); font-family:'Fira Code',monospace;">${escapeHtml(truncated)}</pre>`;

        const escapedText = passageText.replace(/'/g, "''");
        const sql = `INSERT INTO tr_reading_fillblanks (id, passage_with_markers)\nVALUES ('${id}', '${escapedText}');`;
        document.getElementById('sqlCode').textContent = sql;

        const supabaseUrl = localStorage.getItem('supabase_url');
        const supabaseKey = localStorage.getItem('supabase_anon_key');
        document.getElementById('btnSupabaseSave').disabled = !(supabaseUrl && supabaseKey);
    }

    function renderValidationResult(container, result, type) {
        let html = '';

        if (result.pass) {
            html += `<div class="result-banner pass">
                <i class="fas fa-check-circle"></i>
                <span>PASS — 검증 통과</span>
            </div>`;
        } else {
            html += `<div class="result-banner fail">
                <i class="fas fa-times-circle"></i>
                <span>FAIL — ${result.errors.length}개 오류 발견</span>
            </div>`;
        }

        if (result.errors.length > 0) {
            html += `<div class="result-errors"><h4><i class="fas fa-xmark"></i> 오류 (${result.errors.length})</h4>`;
            for (const err of result.errors) {
                html += `<div class="error-item"><i class="fas fa-circle"></i><span>${escapeHtml(err)}</span></div>`;
            }
            html += `</div>`;
        }

        if (result.warnings.length > 0) {
            html += `<div class="result-warnings"><h4><i class="fas fa-triangle-exclamation"></i> 경고 (${result.warnings.length})</h4>`;
            for (const warn of result.warnings) {
                html += `<div class="warning-item"><i class="fas fa-circle"></i><span>${escapeHtml(warn)}</span></div>`;
            }
            html += `</div>`;
        }

        if (type === 'gen' && result.parsed && !result.parsed.error) {
            const p = result.parsed;
            html += `<div class="parsed-summary">
                <h4>파싱 요약</h4>
                <div class="summary-grid">
                    <div class="summary-item"><div class="val">${p.blanks?.length || 0}</div><div class="label">결손 토큰</div></div>
                    <div class="summary-item"><div class="val">${p.answers?.length || 0}</div><div class="label">정답</div></div>
                    <div class="summary-item"><div class="val">${p.mappings?.length || 0}</div><div class="label">매핑</div></div>
                    <div class="summary-item"><div class="val">${p.wordCount || 0}</div><div class="label">단어 수</div></div>
                    <div class="summary-item"><div class="val">${p.sentences?.length || 0}</div><div class="label">문장 수</div></div>
                </div>`;
            if (p.mappings && p.mappings.length > 0) {
                html += `<table class="marker-table" style="margin-top:12px;">
                    <tr><th>#</th><th>토큰</th><th>정답</th><th>완성 단어</th></tr>`;
                for (const m of p.mappings) {
                    const completed = m.token.replace(/_[\s_]*/g, '') + m.answer;
                    html += `<tr>
                        <td>${m.num}</td>
                        <td>${escapeHtml(m.token)}</td>
                        <td>${escapeHtml(m.answer)}</td>
                        <td><span class="marker-word">${escapeHtml(completed)}</span></td>
                    </tr>`;
                }
                html += `</table>`;
            }
            html += `</div>`;
        }

        if (type === 'exp' && result.parsed && !result.parsed.error) {
            const p = result.parsed;
            html += `<div class="parsed-summary">
                <h4>마커 요약</h4>
                <div class="summary-grid">
                    <div class="summary-item"><div class="val">${p.markers?.length || 0}</div><div class="label">마커 수</div></div>
                    <div class="summary-item"><div class="val">${p.markers?.filter(m => m.hasWrongAnswer).length || 0}</div><div class="label">오답 포함</div></div>
                </div>`;
            if (p.markers && p.markers.length > 0) {
                html += `<table class="marker-table" style="margin-top:12px;">
                    <tr><th>#</th><th>완성 단어</th><th>해설 길이</th><th>오답</th></tr>`;
                for (const m of p.markers) {
                    html += `<tr>
                        <td>${m.index}</td>
                        <td><span class="marker-word">${escapeHtml(m.completedWord)}</span></td>
                        <td>${m.explanation.length}자</td>
                        <td>${m.hasWrongAnswer ? `<span class="marker-has-wrong">${escapeHtml(m.wrongAnswer)}</span>` : '-'}</td>
                    </tr>`;
                }
                html += `</table>`;
            }
            html += `</div>`;
        }

        if (result.pass) {
            if (type === 'gen') {
                html += `<button class="btn btn-primary btn-full" style="margin-top:16px;" onclick="document.querySelector('[data-phase=exp]').click()">
                    <i class="fas fa-arrow-right"></i> 다음: 해설프롬 검증으로 이동
                </button>`;
            } else if (type === 'exp') {
                html += `<button class="btn btn-success btn-full" style="margin-top:16px;" onclick="document.querySelector('[data-phase=save]').click()">
                    <i class="fas fa-arrow-right"></i> 다음: 저장 단계로 이동
                </button>`;
            }
        }

        container.innerHTML = html;
    }

    // ============================================
    // Shared Helper Functions
    // ============================================

    async function supabaseInsert(idFieldId, passageText, btnId, statusId) {
        const supabaseUrl = localStorage.getItem('supabase_url');
        const supabaseKey = localStorage.getItem('supabase_anon_key');

        if (!supabaseUrl || !supabaseKey) {
            showSaveStatus(statusId, '설정 페이지에서 Supabase URL과 Anon Key를 먼저 입력해주세요.', 'error');
            return;
        }

        const id = document.getElementById(idFieldId).value;
        const btn = document.getElementById(btnId);

        try {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 저장 중...';

            const response = await fetch(`${supabaseUrl}/rest/v1/tr_reading_fillblanks`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': supabaseKey,
                    'Authorization': `Bearer ${supabaseKey}`,
                    'Prefer': 'return=representation'
                },
                body: JSON.stringify({
                    id: id,
                    passage_with_markers: passageText
                })
            });

            if (response.ok) {
                showSaveStatus(statusId, `✅ 저장 완료! ID: ${id}`, 'success');
                nextSetNumber++;
                btn.innerHTML = '<i class="fas fa-check"></i> 저장 완료';
            } else {
                const err = await response.json();
                showSaveStatus(statusId, `❌ 저장 실패: ${err.message || response.statusText}`, 'error');
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-cloud-arrow-up"></i> Supabase에 직접 INSERT';
            }
        } catch (e) {
            showSaveStatus(statusId, `❌ 네트워크 오류: ${e.message}`, 'error');
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-cloud-arrow-up"></i> Supabase에 직접 INSERT';
        }
    }

    function copyToClipboard(text, statusId) {
        navigator.clipboard.writeText(text).then(() => {
            showSaveStatus(statusId, 'SQL이 클립보드에 복사되었습니다!', 'success');
        }).catch(() => {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            showSaveStatus(statusId, 'SQL이 클립보드에 복사되었습니다!', 'success');
        });
    }

    function showAlert(container, message) {
        container.innerHTML = `<div class="result-banner fail">
            <i class="fas fa-exclamation-triangle"></i>
            <span>${escapeHtml(message)}</span>
        </div>`;
    }

    function showSaveStatus(statusId, message, type) {
        const el = document.getElementById(statusId);
        if (!el) return;
        el.innerHTML = `<div class="save-status-msg ${type}">${message}</div>`;
        if (type === 'success') {
            setTimeout(() => { el.innerHTML = ''; }, 5000);
        }
    }

    function showToast(message, type) {
        const existing = document.querySelector('.toast-notification');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = `toast-notification ${type}`;
        toast.innerHTML = `<i class="fas fa-${type === 'error' ? 'exclamation-circle' : 'check-circle'}"></i><span>${escapeHtml(message)}</span>`;
        document.body.appendChild(toast);

        setTimeout(() => toast.classList.add('show'), 10);
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    function updateSupabaseStatus() {
        const url = localStorage.getItem('supabase_url');
        const key = localStorage.getItem('supabase_anon_key');
        const pill = document.querySelector('.status-pill');
        if (pill) {
            if (url && key) {
                pill.innerHTML = '<i class="fas fa-database"></i> Supabase 연결됨';
                pill.style.color = 'var(--accent-green)';
            } else {
                pill.innerHTML = '<i class="fas fa-database"></i> Supabase 미연결';
                pill.style.color = 'var(--text-muted)';
            }
        }
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ============================================
    // 설정 페이지 - localStorage 저장
    // ============================================
    const settingsPanel = document.getElementById('stepSettings');
    if (settingsPanel) {
        const inputs = settingsPanel.querySelectorAll('.form-input');
        if (inputs[0]) inputs[0].value = localStorage.getItem('supabase_url') || '';
        if (inputs[1]) inputs[1].value = localStorage.getItem('supabase_anon_key') || '';
        if (inputs[2]) inputs[2].value = localStorage.getItem('ai_api_endpoint') || '';

        const saveBtn = settingsPanel.querySelector('.btn-primary');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => {
                if (inputs[0]) localStorage.setItem('supabase_url', inputs[0].value.trim());
                if (inputs[1]) localStorage.setItem('supabase_anon_key', inputs[1].value.trim());
                if (inputs[2]) localStorage.setItem('ai_api_endpoint', inputs[2].value.trim());
                updateSupabaseStatus();
                saveBtn.innerHTML = '<i class="fas fa-check"></i> 저장 완료!';
                setTimeout(() => {
                    saveBtn.innerHTML = '<i class="fas fa-save"></i> 설정 저장';
                }, 2000);
            });
        }
    }

    // ============================================
    // Other step interactions
    // ============================================
    const vTabs = document.querySelectorAll('.v-tab');
    vTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            vTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
        });
    });

    const modelBtns = document.querySelectorAll('.model-btn');
    modelBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            modelBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    // Init
    updateSupabaseStatus();
});
