/* ============================================
   TOEFL Admin - App Logic
   모듈형 구조: 검증 → 저장 파이프라인
   ============================================ */

document.addEventListener('DOMContentLoaded', () => {

    // ============================================
    // State
    // ============================================
    let currentGenParsed = null;  // 생성프롬 검증 통과 데이터
    let currentExpParsed = null;  // 해설프롬 검증 통과 데이터
    let currentExpRaw = null;     // 해설프롬 원본 텍스트
    let nextSetNumber = 15;       // fillblank_set_XXXX 다음 번호

    // ============================================
    // Navigation (Sidebar)
    // ============================================
    const navItems = document.querySelectorAll('.nav-item');
    const stepPanels = document.querySelectorAll('.step-panel');
    const pageTitle = document.getElementById('pageTitle');
    const pageDesc = document.getElementById('pageDesc');

    const stepInfo = {
        '1': { title: '1단계: 검증 → 저장', desc: '생성프롬/해설프롬 출력물을 검증하고 Supabase에 저장합니다' },
        '2': { title: '2단계: AI 자동 생성', desc: 'AI 모델에 프롬프트를 전송하여 문제를 자동으로 생성합니다' },
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
            phaseTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            phasePanels.forEach(p => p.classList.remove('active'));
            const panel = document.getElementById(`phase${phase.charAt(0).toUpperCase() + phase.slice(1)}`);
            if (panel) panel.classList.add('active');
        });
    });

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

        // Pass면 Phase 탭 상태 업데이트
        if (result.pass) {
            phaseTabs[0].classList.add('done');
        } else {
            phaseTabs[0].classList.remove('done');
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

        // Pass면 Phase 탭 상태 업데이트 + 저장 Phase 준비
        if (result.pass) {
            phaseTabs[1].classList.add('done');
            prepareSavePhase(raw);
        } else {
            phaseTabs[1].classList.remove('done');
        }
    });

    // ============================================
    // Step 1 Phase 3: 저장
    // ============================================
    const btnCopySQL = document.getElementById('btnCopySQL');
    const btnSupabaseSave = document.getElementById('btnSupabaseSave');

    btnCopySQL.addEventListener('click', () => {
        const sqlCode = document.getElementById('sqlCode').textContent;
        navigator.clipboard.writeText(sqlCode).then(() => {
            showSaveStatus('SQL이 클립보드에 복사되었습니다!', 'success');
        }).catch(() => {
            // fallback
            const textarea = document.createElement('textarea');
            textarea.value = sqlCode;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            showSaveStatus('SQL이 클립보드에 복사되었습니다!', 'success');
        });
    });

    btnSupabaseSave.addEventListener('click', async () => {
        const supabaseUrl = localStorage.getItem('supabase_url');
        const supabaseKey = localStorage.getItem('supabase_anon_key');

        if (!supabaseUrl || !supabaseKey) {
            showSaveStatus('설정 페이지에서 Supabase URL과 Anon Key를 먼저 입력해주세요.', 'error');
            return;
        }

        const id = document.getElementById('saveId').value;
        const passageWithMarkers = currentExpRaw;

        try {
            btnSupabaseSave.disabled = true;
            btnSupabaseSave.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 저장 중...';

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
                    passage_with_markers: passageWithMarkers
                })
            });

            if (response.ok) {
                showSaveStatus(`✅ 저장 완료! ID: ${id}`, 'success');
                nextSetNumber++;
                btnSupabaseSave.innerHTML = '<i class="fas fa-check"></i> 저장 완료';
            } else {
                const err = await response.json();
                showSaveStatus(`❌ 저장 실패: ${err.message || response.statusText}`, 'error');
                btnSupabaseSave.disabled = false;
                btnSupabaseSave.innerHTML = '<i class="fas fa-cloud-arrow-up"></i> Supabase에 직접 INSERT';
            }
        } catch (e) {
            showSaveStatus(`❌ 네트워크 오류: ${e.message}`, 'error');
            btnSupabaseSave.disabled = false;
            btnSupabaseSave.innerHTML = '<i class="fas fa-cloud-arrow-up"></i> Supabase에 직접 INSERT';
        }
    });

    // ============================================
    // 설정 페이지 - localStorage 저장
    // ============================================
    const settingsPanel = document.getElementById('stepSettings');
    if (settingsPanel) {
        const inputs = settingsPanel.querySelectorAll('.form-input');
        // Load saved values
        if (inputs[0]) inputs[0].value = localStorage.getItem('supabase_url') || '';
        if (inputs[1]) inputs[1].value = localStorage.getItem('supabase_anon_key') || '';
        if (inputs[2]) inputs[2].value = localStorage.getItem('ai_api_endpoint') || '';

        const saveBtn = settingsPanel.querySelector('.btn-primary');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => {
                if (inputs[0]) localStorage.setItem('supabase_url', inputs[0].value.trim());
                if (inputs[1]) localStorage.setItem('supabase_anon_key', inputs[1].value.trim());
                if (inputs[2]) localStorage.setItem('ai_api_endpoint', inputs[2].value.trim());

                // Supabase 연결 상태 업데이트
                updateSupabaseStatus();
                saveBtn.innerHTML = '<i class="fas fa-check"></i> 저장 완료!';
                setTimeout(() => {
                    saveBtn.innerHTML = '<i class="fas fa-save"></i> 설정 저장';
                }, 2000);
            });
        }
    }

    // ============================================
    // Helper Functions
    // ============================================

    function prepareSavePhase(passageText) {
        const id = `fillblank_set_${String(nextSetNumber).padStart(4, '0')}`;
        document.getElementById('saveId').value = id;

        // 미리보기
        const preview = document.getElementById('savePreview');
        const truncated = passageText.length > 500 ? passageText.substring(0, 500) + '...' : passageText;
        preview.innerHTML = `<pre style="white-space:pre-wrap; word-break:break-all; font-size:11px; color:var(--accent-green); font-family:'Fira Code',monospace;">${escapeHtml(truncated)}</pre>`;

        // SQL 생성
        const escapedText = passageText.replace(/'/g, "''");
        const sql = `INSERT INTO tr_reading_fillblanks (id, passage_with_markers)\nVALUES ('${id}', '${escapedText}');`;
        document.getElementById('sqlCode').textContent = sql;

        // Supabase 직접 INSERT 버튼 활성화 여부
        const supabaseUrl = localStorage.getItem('supabase_url');
        const supabaseKey = localStorage.getItem('supabase_anon_key');
        document.getElementById('btnSupabaseSave').disabled = !(supabaseUrl && supabaseKey);
    }

    function renderValidationResult(container, result, type) {
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
        if (result.warnings.length > 0) {
            html += `<div class="result-warnings"><h4><i class="fas fa-triangle-exclamation"></i> 경고 (${result.warnings.length})</h4>`;
            for (const warn of result.warnings) {
                html += `<div class="warning-item"><i class="fas fa-circle"></i><span>${escapeHtml(warn)}</span></div>`;
            }
            html += `</div>`;
        }

        // Parsed Summary
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

            // 매핑 테이블
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

            // 마커 테이블
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

        // Pass일 때 다음 단계 버튼
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

    function showAlert(container, message) {
        container.innerHTML = `<div class="result-banner fail">
            <i class="fas fa-exclamation-triangle"></i>
            <span>${escapeHtml(message)}</span>
        </div>`;
    }

    function showSaveStatus(message, type) {
        const el = document.getElementById('saveStatus');
        el.innerHTML = `<div class="save-status-msg ${type}">${message}</div>`;
        if (type === 'success') {
            setTimeout(() => { el.innerHTML = ''; }, 5000);
        }
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
    // Other step interactions (목업)
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
