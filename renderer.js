// renderer.js — 렌더러 프로세스 (UI 로직). window.planner = preload API
(function () {
  'use strict';

  const WEEK_KO = ['일', '월', '화', '수', '목', '금', '토'];

  // 이모지 피커 목록 (외부 라이브러리 없이 하드코딩 — 오프라인 동작)
  const EMOJIS = [
    // 출제확률/플래너
    '💯', '⭐️', '🔥', '🤔', '🥔', '👑', '🏆', '🎯',
    // 완료/체크
    '✅', '☑️', '✔️', '❌', '⬜',
    // 공부
    '📖', '📚', '✏️', '📝', '📌', '📅', '⏰', '🔖', '💡', '🧠',
    // 강조/감정
    '❗', '⚠️', '✨', '👍', '💪', '❤️', '🔴', '🟡', '🟢',
  ];

  // 상태
  let selectedDate = new Date();   // 현재 보고 있는 날짜
  let calYear, calMonth;           // 캘린더가 표시 중인 연/월
  let markedSet = new Set();       // 내용 있는 날짜 키들
  let editing = false;
  let currentContent = '';         // 현재 보고 있는 날짜의 원문 content (체크박스 토글 시 갱신)
  // 체크박스 토글 저장 직렬화 체인(C-1/C-2). fire-and-forget set 호출을 큐잉해
  // (1) 마지막 의도 상태가 정확히 최종 저장되고, (2) 닫기/날짜이동 직전 await로 flush 가능.
  let pendingSave = Promise.resolve();
  // 전역 메모 저장 직렬화 체인(체크박스 pendingSave와 동일 패턴 — C1).
  // 디바운스 대기 중 창을 닫아도 마지막 입력이 await flush 되도록 추적.
  let memoSave = Promise.resolve();
  let memoDebounceTimer = null;

  // ---------- 유틸 ----------
  function pad(n) { return String(n).padStart(2, '0'); }
  function keyOf(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() &&
           a.getMonth() === b.getMonth() &&
           a.getDate() === b.getDate();
  }
  function isToday(d) { return sameDay(d, new Date()); }

  // ---------- DOM 참조 ----------
  const $ = (id) => document.getElementById(id);
  const el = {
    calTitle: $('calTitle'),
    calGrid: $('calGrid'),
    calPrev: $('calPrev'),
    calNext: $('calNext'),
    plannerDate: $('plannerDate'),
    plannerView: $('plannerView'),
    plannerEdit: $('plannerEdit'),
    btnEmoji: $('btnEmoji'),
    emojiPalette: $('emojiPalette'),
    btnEdit: $('btnEdit'),
    btnSave: $('btnSave'),
    btnCancel: $('btnCancel'),
    btnPrevDay: $('btnPrevDay'),
    btnNextDay: $('btnNextDay'),
    btnToday: $('btnToday'),
    btnPin: $('btnPin'),
    btnMin: $('btnMin'),
    btnClose: $('btnClose'),
    memoBox: $('memoBox'),
  };

  // ---------- 전역 메모 (날짜 무관) ----------
  // 현재 textarea 값을 memoSave 체인에 큐잉해 저장. 닫기 직전 await로 flush 가능(C1).
  function saveMemoNow() {
    if (!el.memoBox) return;
    const snapshot = el.memoBox.value;
    memoSave = memoSave.then(() => window.planner.setMemo(snapshot));
  }

  // ---------- 캘린더 렌더 (요구사항4) ----------
  function renderCalendar() {
    el.calTitle.textContent = `${calYear}년 ${calMonth + 1}월`;
    el.calGrid.innerHTML = '';

    const first = new Date(calYear, calMonth, 1);
    const startWeekday = first.getDay();           // 0=일
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();

    // 앞쪽 빈칸
    for (let i = 0; i < startWeekday; i++) {
      const c = document.createElement('div');
      c.className = 'cal-cell empty';
      el.calGrid.appendChild(c);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(calYear, calMonth, day);
      const k = keyOf(date);
      const cell = document.createElement('div');
      cell.className = 'cal-cell';
      const wd = date.getDay();
      if (wd === 0) cell.classList.add('sun');
      if (wd === 6) cell.classList.add('sat');
      if (isToday(date)) cell.classList.add('today');
      if (sameDay(date, selectedDate)) cell.classList.add('selected');
      cell.textContent = day;

      if (markedSet.has(k)) {
        const dot = document.createElement('span');
        dot.className = 'dot';
        cell.appendChild(dot);
      }

      cell.addEventListener('click', () => {
        if (editing) return; // 편집 중엔 날짜 이동 막음
        selectedDate = date;
        renderCalendar();
        loadPlanner();
      });

      el.calGrid.appendChild(cell);
    }
  }

  // ---------- 플래너 본문 로드 (보기 모드) ----------
  async function loadPlanner() {
    // 날짜 이동/캘린더 클릭 등으로 currentContent를 덮기 전에, in-flight 토글 저장을
    // 먼저 flush해 직전 날짜의 마지막 상태 유실을 방지 — C-1.
    await pendingSave;
    const k = keyOf(selectedDate);
    const wd = WEEK_KO[selectedDate.getDay()];
    el.plannerDate.textContent =
      `${selectedDate.getMonth() + 1}월 ${selectedDate.getDate()}일 (${wd})` +
      (isToday(selectedDate) ? ' · 오늘' : '');

    const content = await window.planner.get(k);
    currentContent = content || '';
    if (content && content.trim().length > 0) {
      renderPlannerBody(content);
      el.plannerView.classList.remove('empty');
    } else {
      el.plannerView.textContent = '아직 계획이 없어요. 수정 버튼으로 추가해보세요 🥔';
      el.plannerView.classList.add('empty');
    }
    setEditMode(false);
  }

  // ---------- 보기 모드 본문 렌더 (작업 A 링크 + 작업 C 체크박스) ----------
  // 안전한 DOM 파서: innerHTML 직접 조립 금지(XSS 방지). createElement/createTextNode만 사용.
  // 마크다운 인라인 링크 [label](url) 지원, GFM 체크리스트 `- [ ]` / `- [x]` 지원.
  function renderPlannerBody(content) {
    el.plannerView.textContent = ''; // 초기화
    const lines = content.split('\n');

    lines.forEach((line, idx) => {
      const lineEl = document.createElement('div');
      lineEl.className = 'pl-line';

      // GFM 체크박스 줄 파싱: 선행 공백 허용 후 `- [ ]` 또는 `- [x]/[X]`
      const m = line.match(/^(\s*)-\s\[([ xX])\]\s?(.*)$/);
      if (m) {
        const checked = m[2].toLowerCase() === 'x';
        const label = m[3];

        lineEl.classList.add('pl-check-line');

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = checked;
        cb.className = 'pl-checkbox';

        const labelSpan = document.createElement('span');
        labelSpan.className = 'pl-label';
        if (checked) labelSpan.classList.add('done');
        appendInline(labelSpan, label);

        // 체크박스 토글 → 해당 줄만 [ ]↔[x] 변경 → 즉시 저장(편집 모드 진입 없이)
        // editing 가드와 무관하게 보기 모드에서 동작.
        cb.addEventListener('change', () => {
          toggleCheckLine(idx, cb.checked);
          labelSpan.classList.toggle('done', cb.checked);
        });

        lineEl.appendChild(cb);
        lineEl.appendChild(labelSpan);
      } else {
        // 일반 줄(들여쓴 "관련:" 줄, 빈 줄 등) — 인라인 링크만 파싱
        if (line.length === 0) {
          lineEl.appendChild(document.createElement('br'));
        } else {
          appendInline(lineEl, line);
        }
      }

      el.plannerView.appendChild(lineEl);
    });
  }

  // 인라인 텍스트를 파싱해 [label](url) 링크는 <a>로, 나머지는 텍스트 노드로 추가.
  // 정규식: label은 ']'를 포함하지 않는 최소 매칭, url은 ')'를 포함하지 않음.
  function appendInline(parent, text) {
    const re = /\[([^\]]+)\]\(([^)]+)\)/g;
    let last = 0;
    let match;
    while ((match = re.exec(text)) !== null) {
      if (match.index > last) {
        parent.appendChild(document.createTextNode(text.slice(last, match.index)));
      }
      const label = match[1];
      const url = match[2];
      const a = document.createElement('a');
      a.className = 'pl-link';
      a.href = '#';
      a.textContent = label;
      a.addEventListener('click', (e) => {
        e.preventDefault();
        window.planner.openExternal(url);
      });
      parent.appendChild(a);
      last = re.lastIndex;
    }
    if (last < text.length) {
      parent.appendChild(document.createTextNode(text.slice(last)));
    }
  }

  // 특정 줄 인덱스의 체크박스 상태를 토글하고 content를 백그라운드 저장.
  // 전체 재렌더 없이 내부 상태(currentContent)만 갱신 → 깜빡임 최소화.
  function toggleCheckLine(lineIndex, checked) {
    const lines = currentContent.split('\n');
    if (lineIndex < 0 || lineIndex >= lines.length) return;
    const line = lines[lineIndex];
    const m = line.match(/^(\s*)-\s\[([ xX])\](\s?.*)$/);
    if (!m) return; // 체크박스 줄이 아니면 무시(안전)
    const indent = m[1];
    const rest = m[3];
    lines[lineIndex] = `${indent}- [${checked ? 'x' : ' '}]${rest}`;
    currentContent = lines.join('\n');
    const k = keyOf(selectedDate);
    // 이 토글 시점의 값을 클로저로 캡처(currentContent 참조가 아니라 스냅샷) — C-2.
    const snapshotContent = currentContent;
    // pendingSave 체인에 큐잉: set 호출을 직렬화(C-2) + 닫기/이동 시 await 가능(C-1).
    // await 안 하므로 UI(취소선)는 즉시 반영되어 체감 블로킹 없음.
    pendingSave = pendingSave.then(() => window.planner.set(k, snapshotContent));
  }

  // ---------- 이모지 피커 ----------
  // 팔레트 그리드 1회 빌드(EMOJIS 배열 → 버튼 셀). mousedown으로 처리해
  // textarea가 blur되기 전에 selectionStart를 읽어 커서 위치를 보존.
  function buildEmojiPalette() {
    el.emojiPalette.textContent = '';
    EMOJIS.forEach((emoji) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'emoji-cell';
      btn.textContent = emoji;
      // mousedown + preventDefault: 클릭 시 textarea 포커스/선택을 빼앗기지 않게.
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        insertEmoji(emoji);
      });
      el.emojiPalette.appendChild(btn);
    });
  }

  // 현재 커서 위치(selectionStart~selectionEnd)에 이모지 삽입 후 커서를 뒤로 이동.
  // 편집 모드에서만 호출되므로 textarea는 항상 표시 상태 → selection 접근 안전.
  function insertEmoji(emoji) {
    const ta = el.plannerEdit;
    const start = ta.selectionStart != null ? ta.selectionStart : ta.value.length;
    const end = ta.selectionEnd != null ? ta.selectionEnd : ta.value.length;
    const before = ta.value.slice(0, start);
    const after = ta.value.slice(end);
    ta.value = before + emoji + after;
    const caret = start + emoji.length;
    ta.focus();
    ta.setSelectionRange(caret, caret);
  }

  function toggleEmojiPalette(force) {
    const show = typeof force === 'boolean'
      ? force
      : el.emojiPalette.classList.contains('hidden');
    el.emojiPalette.classList.toggle('hidden', !show);
    el.btnEmoji.classList.toggle('active', show);
    if (show) el.plannerEdit.focus();
  }

  // ---------- 편집 모드 전환 (요구사항3) ----------
  function setEditMode(on) {
    editing = on;
    if (on) {
      el.plannerView.classList.add('hidden');
      el.plannerEdit.classList.remove('hidden');
      el.btnEmoji.classList.remove('hidden');
      el.btnEdit.classList.add('hidden');
      el.btnSave.classList.remove('hidden');
      el.btnCancel.classList.remove('hidden');
      el.plannerEdit.focus();
    } else {
      el.plannerView.classList.remove('hidden');
      el.plannerEdit.classList.add('hidden');
      el.btnEmoji.classList.add('hidden');
      el.btnEdit.classList.remove('hidden');
      el.btnSave.classList.add('hidden');
      el.btnCancel.classList.add('hidden');
      // 편집 모드 이탈 시 팔레트도 항상 닫기
      toggleEmojiPalette(false);
    }
  }

  async function startEdit() {
    const k = keyOf(selectedDate);
    const content = await window.planner.get(k);
    el.plannerEdit.value = content || '';
    setEditMode(true);
  }

  async function saveEdit() {
    const k = keyOf(selectedDate);
    const val = el.plannerEdit.value;
    await window.planner.set(k, val);
    // 마킹 갱신
    if (val && val.trim().length > 0) markedSet.add(k);
    else markedSet.delete(k);
    setEditMode(false);
    renderCalendar();
    loadPlanner();
  }

  // ---------- 날짜 이동 (요구사항5) ----------
  function shiftDay(delta) {
    if (editing) return;
    selectedDate = new Date(
      selectedDate.getFullYear(),
      selectedDate.getMonth(),
      selectedDate.getDate() + delta
    );
    // 캘린더 표시 달도 따라가기
    calYear = selectedDate.getFullYear();
    calMonth = selectedDate.getMonth();
    renderCalendar();
    loadPlanner();
  }

  function goToday() {
    if (editing) return;
    selectedDate = new Date();
    calYear = selectedDate.getFullYear();
    calMonth = selectedDate.getMonth();
    renderCalendar();
    loadPlanner();
  }

  // ---------- always-on-top 토글 (요구사항2) ----------
  async function refreshPinUI(flag) {
    el.btnPin.classList.toggle('pinned', !!flag);
    el.btnPin.title = flag ? '고정 해제' : '항상 위에 고정';
  }

  // ---------- 초기화 ----------
  async function init() {
    // 마킹된 날짜 로드
    const marked = await window.planner.markedDates();
    markedSet = new Set(marked);

    // 설정(고정 상태) 반영
    const settings = await window.planner.getSettings();
    refreshPinUI(settings.alwaysOnTop);

    // 전역 메모 1회 로드 (날짜 이동과 무관 — 이후 loadPlanner는 memoBox를 건드리지 않음)
    if (el.memoBox) {
      const memo = await window.planner.getMemo();
      el.memoBox.value = memo || '';
    }

    calYear = selectedDate.getFullYear();
    calMonth = selectedDate.getMonth();
    renderCalendar();
    loadPlanner();

    // 이벤트 바인딩
    el.calPrev.addEventListener('click', () => {
      if (editing) return; // 편집 중엔 달 이동 막음 (다른 네비와 일관성) — S1(b)
      calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; }
      renderCalendar();
    });
    el.calNext.addEventListener('click', () => {
      if (editing) return; // 편집 중엔 달 이동 막음 (다른 네비와 일관성) — S1(b)
      calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; }
      renderCalendar();
    });

    el.btnEdit.addEventListener('click', startEdit);
    el.btnSave.addEventListener('click', saveEdit);
    el.btnCancel.addEventListener('click', () => setEditMode(false));

    // 이모지 피커: 팔레트 1회 빌드 + 토글 버튼 + 바깥 클릭 시 닫기
    buildEmojiPalette();
    el.btnEmoji.addEventListener('click', () => toggleEmojiPalette());
    // 팔레트가 열린 상태에서 버튼/팔레트/textarea 바깥을 클릭하면 닫기.
    // (이모지 셀은 mousedown+preventDefault라 클릭이 여기까지 와도 팔레트 내부이므로 유지)
    document.addEventListener('mousedown', (e) => {
      if (el.emojiPalette.classList.contains('hidden')) return;
      const t = e.target;
      if (el.emojiPalette.contains(t) || el.btnEmoji.contains(t) || el.plannerEdit.contains(t)) {
        return;
      }
      toggleEmojiPalette(false);
    });

    el.btnPrevDay.addEventListener('click', () => shiftDay(-1));
    el.btnNextDay.addEventListener('click', () => shiftDay(1));
    el.btnToday.addEventListener('click', goToday);

    el.btnPin.addEventListener('click', async () => {
      const next = await window.planner.toggleAlwaysOnTop();
      refreshPinUI(next);
    });
    el.btnMin.addEventListener('click', () => window.planner.minimize());
    el.btnClose.addEventListener('click', async () => {
      // 편집 중이면 미저장 입력 유실 방지: 먼저 저장하고 닫기 — S1(a)
      if (editing) {
        await saveEdit();
      }
      // 메모: 디바운스 대기 중인 마지막 입력을 즉시 큐잉 후 flush — C-1.
      clearTimeout(memoDebounceTimer);
      saveMemoNow();
      await memoSave;
      // 보기 모드에서도 in-flight 체크박스 토글 저장이 유실되지 않도록 flush — C-1.
      await pendingSave;
      window.planner.close();
    });

    // 전역 메모: 타이핑 시 디바운스 자동저장 + blur 시 즉시 저장 (데이터 유실 방지)
    if (el.memoBox) {
      el.memoBox.addEventListener('input', () => {
        clearTimeout(memoDebounceTimer);
        memoDebounceTimer = setTimeout(saveMemoNow, 400);
      });
      el.memoBox.addEventListener('blur', () => {
        clearTimeout(memoDebounceTimer);
        saveMemoNow();
      });
    }

    // 키보드 단축키: Ctrl+S 저장, Esc 취소, ←/→ 날짜 이동
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (editing) saveEdit();
        return;
      }
      if (e.key === 'Escape' && editing) { setEditMode(false); return; }
      if (!editing) {
        if (e.key === 'ArrowLeft') shiftDay(-1);
        if (e.key === 'ArrowRight') shiftDay(1);
      }
    });
  }

  window.addEventListener('DOMContentLoaded', init);
})();
