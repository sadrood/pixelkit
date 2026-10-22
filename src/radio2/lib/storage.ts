/* 本地持久化：键名与原站一致（roamdial.*），全部带异常捕获 */

const K = {
  lang: "roamdial.lang",
  seen: "roamdial.seen",
  saved: "roamdial.favs",
  recent: "roamdial.recent",
  vol: "roamdial.vol",
  muted: "roamdial.muted",
  last: "roamdial.last",
  hint: "roamdial.hint",
  fx: "roamdial.fx",
  norm: "roamdial.norm",
  autoDive: "roamdial.autoDive",
  autoRec: "roamdial.autoRec",
  favOnly: "roamdial.favOnly",
  eco: "roamdial.eco",
  diveForm: "roamdial.diveForm",
  tapWake: "roamdial.tapwake",
};

function ls(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

function readList(key: string): string[] {
  try {
    const raw = ls()?.getItem(key);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeList(key: string, ids: string[]) {
  try {
    ls()?.setItem(key, JSON.stringify(ids));
  } catch {
    /* ignore */
  }
}

export const storage = {
  getLang(): "zh" | "en" | null {
    const v = ls()?.getItem(K.lang);
    return v === "zh" || v === "en" ? v : null;
  },
  setLang(l: "zh" | "en") {
    try {
      ls()?.setItem(K.lang, l);
    } catch {
      /* ignore */
    }
  },

  /** 是否来过（入口页只给首访） */
  getSeen(): boolean {
    return ls()?.getItem(K.seen) === "1";
  },
  setSeen() {
    try {
      ls()?.setItem(K.seen, "1");
    } catch {
      /* ignore */
    }
  },

  /** 收藏的电台 id 列表（有序，可拖拽排序） */
  getSaved(): string[] {
    return readList(K.saved);
  },
  setSaved(ids: string[]) {
    writeList(K.saved, ids);
  },

  /** 最近听过（有序） */
  getRecent(): string[] {
    return readList(K.recent);
  },
  setRecent(ids: string[]) {
    writeList(K.recent, ids);
  },

  getVolume(): number {
    const v = Number(ls()?.getItem(K.vol));
    return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.8;
  },
  setVolume(v: number) {
    try {
      ls()?.setItem(K.vol, String(v));
    } catch {
      /* ignore */
    }
  },

  getMuted(): boolean {
    return ls()?.getItem(K.muted) === "1";
  },
  setMuted(m: boolean) {
    try {
      ls()?.setItem(K.muted, m ? "1" : "0");
    } catch {
      /* ignore */
    }
  },

  /** 上次收听的电台 id */
  getLast(): string | null {
    return ls()?.getItem(K.last) ?? null;
  },
  setLast(id: string) {
    try {
      ls()?.setItem(K.last, id);
    } catch {
      /* ignore */
    }
  },

  /** 快捷键提示是否显示 */
  getHint(): boolean {
    return ls()?.getItem(K.hint) !== "0";
  },
  setHint(on: boolean) {
    try {
      ls()?.setItem(K.hint, on ? "1" : "0");
    } catch {
      /* ignore */
    }
  },

  getBool(
    key: "fx" | "norm" | "autoRec" | "autoDive" | "favOnly" | "eco" | "tapWake",
    def: boolean,
  ): boolean {
    const v = ls()?.getItem(K[key]);
    return v === null ? def : v === "1";
  },
  setBool(
    key: "fx" | "norm" | "autoRec" | "autoDive" | "favOnly" | "eco" | "tapWake",
    on: boolean,
  ) {
    try {
      ls()?.setItem(K[key], on ? "1" : "0");
    } catch {
      /* ignore */
    }
  },

  /** 唱片效果样式：genre/random/disc/orb/field/radar/galaxy/waves/pulsar/ring */
  getDiveForm(): string {
    return ls()?.getItem(K.diveForm) ?? "genre";
  },
  setDiveForm(f: string) {
    try {
      ls()?.setItem(K.diveForm, f);
    } catch {
      /* ignore */
    }
  },
};
