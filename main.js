// main.js — Electron 메인 프로세스
const { app, BrowserWindow, ipcMain, screen, shell } = require('electron');
const path = require('path');
const Store = require('./store');

let win = null;
let store = null;

// 기본 위젯 크기 (우측에 작게)
const DEFAULT_W = 360;
const DEFAULT_H = 600;

// 저장된 bounds가 현재 연결된 디스플레이 중 하나라도 작업영역과 겹치는지 검증.
// (외부 모니터에서 닫고 그 모니터를 제거하면 창이 화면 밖에 떠서 사라지는 문제 방지 — C2)
function isVisibleOnSomeDisplay(b) {
  if (!b || typeof b.x !== 'number' || typeof b.y !== 'number' ||
      typeof b.width !== 'number' || typeof b.height !== 'number') {
    return false;
  }
  return screen.getAllDisplays().some((d) => {
    const wa = d.workArea;
    return b.x < wa.x + wa.width && b.x + b.width > wa.x &&
           b.y < wa.y + wa.height && b.y + b.height > wa.y;
  });
}

// 기본 우측 배치 bounds 계산 (폴백용)
function defaultBounds() {
  const display = screen.getPrimaryDisplay();
  const wa = display.workArea; // 작업표시줄 제외 영역
  return {
    width: DEFAULT_W,
    height: DEFAULT_H,
    x: wa.x + wa.width - DEFAULT_W - 24,
    y: wa.y + 24,
  };
}

function createWindow() {
  store = new Store(app.getPath('userData'));
  const settings = store.getSettings();

  // 저장된 위치/크기가 있고 + 현재 디스플레이에 보이는 위치면 복원, 아니면 기본 우측 배치 (C2)
  let bounds = settings.bounds;
  if (!bounds || !isVisibleOnSomeDisplay(bounds)) {
    bounds = defaultBounds();
  }

  win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: 280,
    minHeight: 380,
    frame: false,            // frameless → 커스텀 상단바
    transparent: false,
    resizable: true,         // 요구사항1: 크기 조절 가능
    skipTaskbar: false,
    alwaysOnTop: settings.alwaysOnTop, // 요구사항2: always-on-top 복원
    backgroundColor: '#f7f5f0',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,   // 보안
      nodeIntegration: false,   // 보안
      sandbox: false,
    },
  });

  if (settings.alwaysOnTop) {
    win.setAlwaysOnTop(true, 'floating');
  }

  win.loadFile('index.html');

  // 창 이동/리사이즈 시 위치·크기 저장 (요구사항1)
  const saveBounds = debounce(() => {
    if (win && !win.isDestroyed()) {
      store.setBounds(win.getBounds());
    }
  }, 400);
  win.on('move', saveBounds);
  win.on('resize', saveBounds);

  // 종료 직전 디바운스 무시하고 즉시 위치 저장 (C1)
  // win이 아직 destroy 안 된 시점이라 getBounds()가 유효.
  win.on('close', () => {
    if (win && !win.isDestroyed()) {
      store.setBounds(win.getBounds());
    }
  });

  win.on('closed', () => {
    win = null;
  });
}

function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// ---------- IPC 핸들러 ----------

// 플래너 본문 조회
ipcMain.handle('planner:get', (e, dateKey) => {
  return store.getPlanner(dateKey);
});

// 플래너 본문 저장
ipcMain.handle('planner:set', (e, dateKey, content) => {
  return store.setPlanner(dateKey, content);
});

// 내용 있는 날짜 목록 (캘린더 점 표시)
ipcMain.handle('planner:markedDates', () => {
  return store.getMarkedDates();
});

// 설정(창 상태) 조회
ipcMain.handle('settings:get', () => {
  return store.getSettings();
});

// 전역 메모 조회 (날짜 무관)
ipcMain.handle('memo:get', (e) => {
  if (!win || e.sender !== win.webContents) return '';
  return store.getMemo();
});

// 전역 메모 저장 (날짜 무관, settings에 저장 → 날짜별 데이터와 분리)
ipcMain.handle('memo:set', (e, text) => {
  if (!win || e.sender !== win.webContents) return false;
  return store.setMemo(typeof text === 'string' ? text : '');
});

// always-on-top 토글
ipcMain.handle('window:toggleAlwaysOnTop', () => {
  const next = !store.getSettings().alwaysOnTop;
  store.setAlwaysOnTop(next);
  if (win) win.setAlwaysOnTop(next, 'floating');
  return next;
});

// 외부 브라우저로 링크 열기 (작업 A)
// 보안: 발신자 검증 + http/https 프로토콜만 허용 (file:/javascript: 등 차단)
ipcMain.handle('shell:openExternal', (e, url) => {
  if (!win || e.sender !== win.webContents) return false;
  if (typeof url !== 'string') return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch (_) {
    return false;
  }
  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
    shell.openExternal(url);
    return true;
  }
  return false;
});

// 창 컨트롤 (S4: 발신자가 우리 창의 webContents인지 검증)
ipcMain.on('window:minimize', (e) => {
  if (!win || e.sender !== win.webContents) return;
  win.minimize();
});
ipcMain.on('window:close', (e) => {
  if (!win || e.sender !== win.webContents) return;
  win.close();
});

// ---------- 앱 라이프사이클 ----------
// 종료 시 한 번 더 위치 저장 (C1 안전망). close 이벤트를 못 탄 경우 대비.
app.on('before-quit', () => {
  if (win && !win.isDestroyed()) {
    store.setBounds(win.getBounds());
  }
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // 검증용: --quit-after=N (초) 옵션이 있으면 N초 후 자동 종료
  // (N4: 릴리스 빌드에서 인자로 종료되지 않도록 개발 모드에서만 동작)
  const quitArg = process.argv.find((a) => a.startsWith('--quit-after='));
  if (quitArg && !app.isPackaged) {
    const sec = parseInt(quitArg.split('=')[1], 10) || 5;
    console.log(`[main] --quit-after=${sec}s : 기동 검증 모드`);
    setTimeout(() => {
      console.log('[main] 자동 종료');
      app.quit();
    }, sec * 1000);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
