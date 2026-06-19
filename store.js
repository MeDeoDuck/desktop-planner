// store.js — 로컬 JSON 저장소 (메인 프로세스에서만 사용)
// 데이터는 app.getPath('userData') 안에 저장하여 OneDrive 동기화 충돌 회피.

const fs = require('fs');
const path = require('path');

class Store {
  constructor(userDataDir) {
    this.dir = userDataDir;
    if (!fs.existsSync(this.dir)) {
      fs.mkdirSync(this.dir, { recursive: true });
    }
    // 플래너 본문 (날짜별)
    this.plannerPath = path.join(this.dir, 'planner-data.json');
    // 창 상태/설정
    this.settingsPath = path.join(this.dir, 'window-settings.json');

    this.planner = this._read(this.plannerPath, {});
    this.settings = this._read(this.settingsPath, {
      bounds: null,          // { x, y, width, height }
      alwaysOnTop: false,
      memo: '',              // 전역(날짜 무관) 메모. planner-data.json과 절대 섞지 않음.
    });
  }

  _read(file, fallback) {
    let raw = null;
    try {
      if (fs.existsSync(file)) {
        raw = fs.readFileSync(file, 'utf-8');
        return JSON.parse(raw);
      }
    } catch (e) {
      console.error('[store] read fail', file, e.message);
      // JSON 파싱 실패 등 손상 → 빈 객체로 덮어쓰기 전에 원본을 백업해 복구 여지 확보 (S2)
      if (raw !== null) {
        this._backupCorrupt(file, raw);
      }
    }
    return fallback;
  }

  // 손상된 원본을 timestamp 붙여 백업 (데이터 확정 유실 방지) (S2)
  _backupCorrupt(file, raw) {
    try {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const dir = path.dirname(file);
      const base = path.basename(file, path.extname(file)); // e.g. planner-data
      const backupPath = path.join(dir, `${base}.corrupt-${ts}.json`);
      fs.writeFileSync(backupPath, raw, 'utf-8');
      console.error('[store] corrupt backup saved →', backupPath);
    } catch (e) {
      console.error('[store] corrupt backup fail', file, e.message);
    }
  }

  // 원자적 쓰기: temp 파일에 쓰고 rename으로 교체 → 쓰는 도중 종료돼도 원본 파일은 온전 (S3)
  _write(file, obj) {
    const tmp = `${file}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf-8');
      fs.renameSync(tmp, file);
      return true;
    } catch (e) {
      console.error('[store] write fail', file, e.message);
      // temp 파일이 남았으면 정리 (실패는 무시)
      try {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
      } catch (_) { /* noop */ }
      return false;
    }
  }

  // ---- 플래너 본문 (key = YYYY-MM-DD) ----
  getPlanner(dateKey) {
    return this.planner[dateKey] || '';
  }

  setPlanner(dateKey, content) {
    if (content && content.trim().length > 0) {
      this.planner[dateKey] = content;
    } else {
      delete this.planner[dateKey];
    }
    return this._write(this.plannerPath, this.planner);
  }

  // 내용이 있는 날짜 목록 (캘린더 점 표시용)
  getMarkedDates() {
    return Object.keys(this.planner).filter(
      (k) => this.planner[k] && this.planner[k].trim().length > 0
    );
  }

  // ---- 창 상태/설정 ----
  getSettings() {
    return this.settings;
  }

  setBounds(bounds) {
    this.settings.bounds = bounds;
    return this._write(this.settingsPath, this.settings);
  }

  setAlwaysOnTop(flag) {
    this.settings.alwaysOnTop = !!flag;
    return this._write(this.settingsPath, this.settings);
  }

  // ---- 전역 메모 (날짜 무관, settings에 저장) ----
  // planner-data.json(날짜별)과 완전 분리 → getMarkedDates/캘린더 점에 영향 없음.
  getMemo() {
    return this.settings.memo || '';
  }

  setMemo(text) {
    this.settings.memo = typeof text === 'string' ? text : '';
    return this._write(this.settingsPath, this.settings);
  }
}

module.exports = Store;
