/*  小月亮 · 经期记录
 *  纯本地运行：数据存在这台设备的 localStorage 里，不联网、不上传。
 *  推算方法参考了 IraSoro/peri 的 CALCULATION.md 与常见经期 App 的通行做法。
 */
(function () {
  "use strict";

  const STORE_KEY = "xiaoyueliang.v1";
  const APP_VERSION = "1.0.0";

  const SYMPTOMS = ["腹痛", "腰酸", "头痛", "乳房胀痛", "疲惫", "嗜睡", "失眠",
                    "情绪波动", "长痘", "水肿", "恶心", "便秘", "腹泻", "食欲大增"];
  const MOODS    = ["开心", "平静", "烦躁", "低落", "焦虑", "敏感", "精力充沛", "想哭", "想要抱抱"];
  const FLOWS    = [
    { v: 0, label: "无" },
    { v: 1, label: "少量" },
    { v: 2, label: "中量" },
    { v: 3, label: "大量" }
  ];

  const PHASE_META = {
    menstrual:  { name: "经期",     color: "--menstrual"  },
    follicular: { name: "卵泡期",   color: "--follicular" },
    ovulation:  { name: "排卵期",   color: "--ovulation"  },
    luteal:     { name: "黄体期",   color: "--luteal"     },
    overdue:    { name: "已推迟",   color: "--danger"     },
    unknown:    { name: "还没数据", color: "--text-3"     }
  };

  const TIPS = {
    menstrual: "这几天多喝热水、注意保暖，别硬撑。累了就睡，运动改成散步就好。",
    follicular: "精力在回升，身体状态通常最好，想做的事可以安排在这几天。",
    ovulation: "分泌物可能变多、体温略升，这几天是受孕概率最高的时候。",
    luteal: "容易水肿、嘴馋、情绪起伏，经前一周尤其明显。对自己宽容一点，少喝冰的、少熬夜会有帮助。",
    overdue: "推迟一周以内都可能正常，压力大、熬夜、生病、突然改变作息都会影响。超过 10 天还没来，建议验孕或看医生。",
    unknown: "先记一次「经期来了」，我就知道从哪里开始算了。"
  };

  /* ── 日期小工具 ─────────────────────────────── */
  const pad = (n) => String(n).padStart(2, "0");
  const D = {
    fmt(dt) { return dt.getFullYear() + "-" + pad(dt.getMonth() + 1) + "-" + pad(dt.getDate()); },
    parse(s) { const p = s.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); },
    today() { return D.fmt(new Date()); },
    add(s, n) { const dt = D.parse(s); dt.setDate(dt.getDate() + n); return D.fmt(dt); },
    utc(s) { const p = s.split("-"); return Date.UTC(+p[0], +p[1] - 1, +p[2]); },
    diff(a, b) { return Math.round((D.utc(b) - D.utc(a)) / 86400000); },
    cn(s) { const dt = D.parse(s); return (dt.getMonth() + 1) + "月" + dt.getDate() + "日"; },
    cnShort(s) { const dt = D.parse(s); return (dt.getMonth() + 1) + "/" + dt.getDate(); },
    weekday(s) { return "日一二三四五六"[D.parse(s).getDay()]; }
  };

  /* ── 数据存取 ───────────────────────────────── */
  const defaults = () => ({
    v: 1,
    settings: {
      name: "",
      autoCycle: true,
      cycleLength: 28,
      periodLength: 5,
      notify: false,
      leadDays: 2,
      theme: "auto",
      sticker: "",         // 她自己上传的贴纸（data URL，只存在本地）
      lastBackup: ""       // 上次导出备份的日期，用来提醒她别一直不备份
    },
    logs: {}
  });

  let state = defaults();

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      state = Object.assign(defaults(), parsed);
      state.settings = Object.assign(defaults().settings, parsed.settings || {});
      state.logs = parsed.logs || {};
    } catch (e) {
      console.warn("读取本地数据失败，先用空数据", e);
    }
  }

  let saveTimer = null;
  function save(now) {
    const write = () => {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
      catch (e) { toast("保存失败：设备存储空间可能满了"); }
    };
    clearTimeout(saveTimer);
    if (now) { write(); return; }
    saveTimer = setTimeout(write, 200);
  }

  const dayLog = (dateStr) => state.logs[dateStr] || null;

  function editDay(dateStr, fn) {
    const cur = state.logs[dateStr] || { flow: 0, symptoms: [], moods: [], note: "" };
    fn(cur);
    const empty = !cur.flow && !(cur.symptoms || []).length &&
                  !(cur.moods || []).length && !(cur.note || "").trim();
    if (empty) delete state.logs[dateStr];
    else state.logs[dateStr] = cur;
    save();
  }

  /* ── 周期推算 ───────────────────────────────── */
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

  /* 把「流量大于 0」的日期合并成一次次经期。
     只合并中间最多漏记一天的情况（比如第 1 天和第 3 天各点了一次）。
     阈值不敢放宽：合并会把经期的「开始日」往前挪，而开始日决定了下次经期的
     预测日期——挪错几天比「经期长度算短一点」严重得多，后者还能回落到设置值。
     另外限制单段不超过 12 天，避免偶发的点滴出血把经期长度撑大。*/
  const MERGE_MAX_GAP = 2;
  const MAX_SEGMENT = 12;

  function derivePeriods() {
    const days = Object.keys(state.logs)
      .filter((d) => state.logs[d] && state.logs[d].flow > 0)
      .sort();
    const out = [];
    for (const d of days) {
      const last = out[out.length - 1];
      const gap = last ? D.diff(last.end, d) : null;
      const spanIfMerged = last ? D.diff(last.start, d) + 1 : null;
      if (last && gap >= 1 && gap <= MERGE_MAX_GAP && spanIfMerged <= MAX_SEGMENT) last.end = d;
      else out.push({ start: d, end: d });
    }
    return out;
  }

  let modelCache = null;
  const invalidate = () => { modelCache = null; };

  function model() {
    if (modelCache) return modelCache;
    const s = state.settings;
    const periods = derivePeriods();
    const starts = periods.map((p) => p.start);

    /* 周期长度 = 相邻两次开始日的间隔。
       小于 15 天多半是同一次误记，大于 90 天多半是漏记，都不参与平均。*/
    const gaps = [];
    for (let i = 1; i < starts.length; i++) {
      const g = D.diff(starts[i - 1], starts[i]);
      if (g >= 15 && g <= 90) gaps.push(g);
    }
    const learnedCycle = gaps.length ? Math.round(mean(gaps)) : null;
    const cycleLength = (s.autoCycle && learnedCycle) ? learnedCycle : s.cycleLength;

    /* 经期长度：只有记录得比较完整（至少 3 天）时才采信实测值。*/
    const measured = periods.map((p) => D.diff(p.start, p.end) + 1);
    const avgMeasured = measured.length ? mean(measured) : 0;
    const measuredPeriod = avgMeasured >= 3 ? Math.round(avgMeasured) : null;
    const periodLength = measuredPeriod || s.periodLength;

    const today = D.today();
    const lastStart = starts.length ? starts[starts.length - 1] : null;
    const nextDue = lastStart ? D.add(lastStart, cycleLength) : null;
    const dayOfCycle = lastStart ? D.diff(lastStart, today) + 1 : null;
    const daysUntil = nextDue ? D.diff(today, nextDue) : null;

    /* 排卵日一般在下次经期前 14 天；易孕窗口取排卵前 5 天到排卵后 1 天。*/
    const ovulationDay = Math.max(8, cycleLength - 14);
    const fertileFrom = Math.max(1, ovulationDay - 5);
    const fertileTo = ovulationDay + 1;

    const currentPeriod = periods.filter((p) => today >= p.start && today <= p.end).pop() || null;
    const inPeriod = !!currentPeriod;
    const dayOfPeriod = currentPeriod ? D.diff(currentPeriod.start, today) + 1 : null;

    let phase = "unknown";
    if (lastStart) {
      if (inPeriod) phase = "menstrual";
      /* 周期第 1 天是开始日，所以「正好到期」那天是 cycleLength + 1 天。
         要再过一天才算推迟，否则到期当天会一边写「预计就是今天」一边标「已推迟」。*/
      else if (dayOfCycle > cycleLength + 1) phase = "overdue";
      else if (Math.abs(dayOfCycle - ovulationDay) <= 1) phase = "ovulation";
      else if (dayOfCycle < ovulationDay - 1) phase = "follicular";
      else phase = "luteal";
    }

    modelCache = {
      periods, starts, gaps, learnedCycle, cycleLength, periodLength, measuredPeriod, lastStart,
      nextDue, dayOfCycle, daysUntil, ovulationDay, fertileFrom, fertileTo,
      inPeriod, dayOfPeriod, phase, today
    };
    return modelCache;
  }

  /* 预测某一天（只给未来的日子涂色，过去的空白日子不猜）。*/
  function predict(dateStr) {
    const m = model();
    const res = {};
    if (!m.lastStart) return res;
    if (D.diff(m.today, dateStr) <= 0) return res;
    let off = D.diff(m.lastStart, dateStr) + 1;
    if (off < 1) return res;
    if (off > m.cycleLength) off -= Math.floor((off - 1) / m.cycleLength) * m.cycleLength;
    if (off <= m.periodLength) res.predicted = true;
    if (Math.abs(off - m.ovulationDay) <= 1) res.ovulation = true;
    if (off >= m.fertileFrom && off <= m.fertileTo) res.fertile = true;
    return res;
  }

  /* ── 通用小工具 ─────────────────────────────── */
  const $ = (id) => document.getElementById(id);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const toggle = (arr, v) => arr.includes(v) ? arr.filter((x) => x !== v) : arr.concat([v]);

  let toastTimer = null;
  function toast(msg) {
    const el = $("toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
  }

  function applyTheme() {
    const t = state.settings.theme;
    const dark = t === "dark" ||
      (t === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }

  function chip(label, pressed, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.textContent = label;
    b.setAttribute("aria-pressed", pressed ? "true" : "false");
    b.addEventListener("click", onClick);
    return b;
  }

  /* ── 首页 ───────────────────────────────────── */
  const RING = 2 * Math.PI * 52;

  function renderHome() {
    const m = model();
    const s = state.settings;
    const hour = new Date().getHours();

    $("greeting").textContent = hour < 5 ? "夜深了" : hour < 11 ? "早上好"
      : hour < 14 ? "中午好" : hour < 18 ? "下午好" : "晚上好";
    $("helloName").textContent = s.name ? (s.name + "，今天感觉怎么样") : "今天感觉怎么样";

    let num = "–", unit = "天", line = "", sub = "", progress = 0;
    const meta = PHASE_META[m.phase] || PHASE_META.unknown;

    if (!m.lastStart) {
      line = "还没有记录";
      sub = "点下面的「经期来了」记一次，之后就能预测了";
    } else if (m.inPeriod) {
      const n = m.dayOfPeriod;
      num = n; unit = "天";
      line = "正在经期中";
      const left = Math.max(0, m.periodLength - n);
      sub = left > 0 ? "按平时的情况，大概还有 " + left + " 天左右" : "这次差不多要结束了";
      progress = Math.min(1, n / Math.max(1, m.periodLength));
    } else {
      const d = m.daysUntil;
      num = Math.abs(d); unit = "天";
      if (d > 0) line = "距离下次经期";
      else if (d === 0) { num = "今"; line = "预计就是今天"; }
      else line = "已经推迟了";
      progress = Math.min(1, m.dayOfCycle / Math.max(1, m.cycleLength));
      sub = "周期第 " + m.dayOfCycle + " 天 · 平均 " + m.cycleLength + " 天";
    }

    $("heroNum").textContent = num;
    $("heroUnit").textContent = unit;
    $("heroLine").textContent = line;
    $("heroSub").textContent = sub;
    $("lastStart").textContent = m.lastStart ? D.cnShort(m.lastStart) : "—";
    $("nextDue").textContent = m.nextDue ? D.cnShort(m.nextDue) : "—";

    const pill = $("phasePill");
    pill.textContent = meta.name;
    pill.className = "pill p-" + m.phase;

    /* 小月亮的表情跟着周期走：经期是安慰脸、排卵是星星眼、黄体期打瞌睡。*/
    $("mascot").dataset.mood = (m.phase === "unknown") ? "normal" : m.phase;

    const ring = $("ringFg");
    ring.style.strokeDashoffset = String(RING * (1 - (progress || 0)));
    ring.style.stroke = "var(" + meta.color + ")";

    renderQuick();
    renderToday();
    /* 正好是预测当天时，黄体期那段「经前一周」的小提示就不合时宜了。*/
    $("tipText").textContent = (m.daysUntil === 0 && !m.inPeriod)
      ? "预计就是今天。提前把要用的东西准备好，别让自己手忙脚乱。"
      : (TIPS[m.phase] || TIPS.unknown);
  }

  function renderQuick() {
    const m = model();
    const start = $("btnPeriodStart"), todayBtn = $("btnPeriodToday"), end = $("btnPeriodEnd");
    const loggedToday = !!(dayLog(m.today) && dayLog(m.today).flow > 0);
    const show = (el, on) => { el.style.display = on ? "" : "none"; };

    if (m.inPeriod) {
      show(start, false);
      show(todayBtn, !loggedToday);
      show(end, loggedToday);
      end.textContent = "经期结束了";
    } else {
      show(start, true);
      start.textContent = "经期来了";
      show(todayBtn, false);
      show(end, false);
    }
  }

  function renderToday() {
    const t = D.today();
    const log = dayLog(t) || { flow: 0, symptoms: [], moods: [], note: "" };
    const dt = D.parse(t);
    $("todayLabel").textContent = (dt.getMonth() + 1) + "月" + dt.getDate() + "日 周" + D.weekday(t);

    const flowBox = $("flowChips");
    flowBox.innerHTML = "";
    FLOWS.forEach((f) => {
      flowBox.appendChild(chip(f.label, (log.flow || 0) === f.v, () => {
        editDay(t, (d) => { d.flow = f.v; });
        invalidate(); renderAll();
      }));
    });

    const sBox = $("symptomChips");
    sBox.innerHTML = "";
    SYMPTOMS.forEach((name) => {
      sBox.appendChild(chip(name, (log.symptoms || []).includes(name), () => {
        editDay(t, (d) => { d.symptoms = toggle(d.symptoms || [], name); });
        renderToday();
      }));
    });

    const mBox = $("moodChips");
    mBox.innerHTML = "";
    MOODS.forEach((name) => {
      mBox.appendChild(chip(name, (log.moods || []).includes(name), () => {
        editDay(t, (d) => { d.moods = toggle(d.moods || [], name); });
        renderToday();
      }));
    });

    const note = $("noteInput");
    if (document.activeElement !== note) note.value = log.note || "";
  }

  /* ── 日历 ───────────────────────────────────── */
  let calMonth = null;

  function renderCalendar() {
    const m = model();
    if (!calMonth) calMonth = m.today.slice(0, 7);
    const ym = calMonth.split("-");
    const y = Number(ym[0]), mo = Number(ym[1]);
    $("calTitle").textContent = y + "年" + mo + "月";

    const week = $("calWeek");
    if (!week.childElementCount) {
      ["一", "二", "三", "四", "五", "六", "日"].forEach((w) => {
        const sp = document.createElement("span");
        sp.textContent = w;
        week.appendChild(sp);
      });
    }

    const grid = $("calGrid");
    grid.innerHTML = "";
    const lead = (new Date(y, mo - 1, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(y, mo, 0).getDate();
    const prevDays = new Date(y, mo - 1, 0).getDate();

    for (let i = 0; i < lead; i++) {
      const b = document.createElement("button");
      b.className = "day pad";
      b.disabled = true;
      b.textContent = String(prevDays - lead + 1 + i);
      grid.appendChild(b);
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const ds = y + "-" + pad(mo) + "-" + pad(d);
      const b = document.createElement("button");
      b.className = "day";
      b.dataset.date = ds;

      const notFuture = D.diff(m.today, ds) >= 0;
      const actual = m.periods.some((p) => ds >= p.start && ds <= p.end);
      const pr = predict(ds);

      if (actual) b.classList.add("is-menstrual");
      else if (pr.predicted) b.classList.add("is-predicted");
      if (pr.ovulation) b.classList.add("is-ovulation");
      else if (pr.fertile) b.classList.add("is-fertile");
      if (notFuture && state.logs[ds]) b.classList.add("has-log");
      if (ds === m.today) b.classList.add("today");

      const n = document.createElement("span");
      n.className = "day-num";
      n.textContent = String(d);
      b.appendChild(n);
      grid.appendChild(b);
    }

    renderHistory();
  }

  function renderHistory() {
    const m = model();
    const box = $("periodList");
    const list = m.periods.slice().reverse().slice(0, 8);
    if (!list.length) {
      box.innerHTML = '<p class="empty">还没有记录过经期。</p>';
      return;
    }
    box.innerHTML = "";
    list.forEach((p) => {
      const idx = m.periods.indexOf(p);
      const gap = idx > 0 ? D.diff(m.periods[idx - 1].start, p.start) : null;
      const len = D.diff(p.start, p.end) + 1;
      const row = document.createElement("div");
      row.className = "hist-row";
      row.innerHTML =
        "<span>" + D.cn(p.start) + "</span>" +
        '<span class="grow">' + len + " 天" +
        (gap && gap >= 15 && gap <= 90 ? " · 周期 " + gap + " 天" : "") + "</span>";
      box.appendChild(row);
    });
  }

  /* ── 统计 ───────────────────────────────────── */
  function renderStats() {
    const m = model();
    const row = $("statRow");
    /* 没有实测数据时就显示「—」，不要拿设置里的默认值冒充她自己的平均值。*/
    const cards = [
      { v: m.learnedCycle === null ? "—" : m.learnedCycle, u: "天", k: "平均周期" },
      { v: m.measuredPeriod === null ? "—" : m.measuredPeriod, u: "天", k: "平均经期" },
      { v: m.gaps.length ? Math.min.apply(null, m.gaps) + "–" + Math.max.apply(null, m.gaps) : "—",
        u: "", k: "周期最短–最长" },
      { v: m.periods.length, u: "次", k: "记录到的经期" }
    ];
    row.innerHTML = "";
    cards.forEach((c) => {
      const unit = (c.v === "—") ? "" : c.u;
      const div = document.createElement("div");
      div.className = "stat";
      div.innerHTML = '<div class="v">' + c.v + (unit ? "<small>" + unit + "</small>" : "") +
                      '</div><div class="k">' + c.k + "</div>";
      row.appendChild(div);
    });

    const bars = $("cycleBars");
    bars.innerHTML = "";
    const recent = m.gaps.slice(-6);
    bars.classList.toggle("bars-empty", !recent.length);
    if (!recent.length) {
      bars.innerHTML = '<p class="empty">至少记两次经期，才能看出周期长度。</p>';
    } else {
      const maxV = Math.max.apply(null, recent.concat([m.cycleLength])) + 4;
      recent.forEach((g, i) => {
        const startIdx = m.gaps.length - recent.length + i;
        const wrap = document.createElement("div");
        wrap.className = "bar-wrap";
        const h = Math.max(6, Math.round((g / maxV) * 100));
        const cls = g < m.cycleLength - 3 ? " is-short" : g > m.cycleLength + 3 ? " is-long" : "";
        const label = m.starts[startIdx + 1] ? D.cnShort(m.starts[startIdx + 1]) : "最近";
        wrap.innerHTML = '<span class="bar-val">' + g + '</span>' +
                         '<div class="bar' + cls + '" style="height:' + h + '%"></div>' +
                         '<span class="bar-lab">' + label + "</span>";
        bars.appendChild(wrap);
      });
    }

    const hint = $("regularityHint");
    if (m.gaps.length >= 2) {
      const spread = Math.max.apply(null, m.gaps) - Math.min.apply(null, m.gaps);
      if (spread <= 4) hint.textContent = "周期很规律，最长最短相差不超过 4 天。";
      else if (spread <= 8) hint.textContent = "周期比较规律，波动在 " + spread + " 天以内，这很常见。";
      else hint.textContent = "波动有点大（相差 " + spread + " 天）。熬夜、压力、减重、生病都会影响；一直不规则的话建议看看医生。";
    } else {
      hint.textContent = "多记几次，就能看出规律了。";
    }

    const ov = m.ovulationDay, cyc = m.cycleLength, pl = m.periodLength;
    const rows = [
      { c: "--menstrual",  n: "经期",     r: "第 1–" + pl + " 天" },
      { c: "--follicular", n: "卵泡期",   r: "第 " + (pl + 1) + "–" + (ov - 2) + " 天" },
      { c: "--ovulation",  n: "排卵期",   r: "第 " + (ov - 1) + "–" + (ov + 1) + " 天" },
      { c: "--fertile",    n: "易孕窗口", r: "第 " + m.fertileFrom + "–" + m.fertileTo + " 天" },
      { c: "--luteal",     n: "黄体期",   r: "第 " + (ov + 2) + "–" + cyc + " 天" }
    ];
    const box = $("phaseLegend");
    box.innerHTML = "";
    rows.forEach((r) => {
      const d = document.createElement("div");
      d.className = "pl-row";
      d.innerHTML = '<i class="pl-swatch" style="background:var(' + r.c + ')"></i>' +
                    "<span>" + r.n + '</span><span class="pl-days">' + r.r + "</span>";
      box.appendChild(d);
    });
  }

  /* ── 设置 ───────────────────────────────────── */
  function renderSettings() {
    const s = state.settings;
    const m = model();

    $("nameInput").value = s.name || "";
    $("autoCycle").checked = !!s.autoCycle;
    $("cycleLenVal").textContent = s.cycleLength + " 天";
    $("periodLenVal").textContent = s.periodLength + " 天";
    $("cycleRow").style.opacity = s.autoCycle ? "0.45" : "1";
    $("autoCycleHint").textContent = m.learnedCycle
      ? "（实测平均 " + m.learnedCycle + " 天）" : "（还没攒够数据）";

    $("notifyOn").checked = !!s.notify;
    $("leadDaysVal").textContent = s.leadDays + " 天";
    const perm = ("Notification" in window) ? Notification.permission : "unsupported";
    $("notifyHint").textContent = perm === "granted" ? "（已允许通知）"
      : perm === "denied" ? "（被浏览器拒绝了，要到设置里打开）"
      : perm === "unsupported" ? "（这台设备不支持）" : "";

    const box = $("themeChips");
    box.innerHTML = "";
    [["auto", "跟随系统"], ["light", "浅色"], ["dark", "深色"]].forEach((pair) => {
      box.appendChild(chip(pair[1], s.theme === pair[0], () => {
        state.settings.theme = pair[0];
        save(true); applyTheme(); renderSettings();
      }));
    });

    $("aboutText").textContent =
      "小月亮 v" + APP_VERSION + " · 所有记录只保存在这台设备上。" +
      "预测根据你过去几次周期的长度估算，仅供参考——不能当作医疗建议，也不能当作避孕依据。";

    /* 数据只在本地，清浏览器数据或换手机就没了，所以提示一下备份的时机。*/
    const last = s.lastBackup;
    const days = Object.keys(state.logs).length;
    $("backupHint").textContent = !days
      ? "还没有记录，暂时不用备份。"
      : !last
        ? "还没有备份过。点一下上面的「导出备份」，把文件存到手机里或发给自己，换手机时就有用了。"
        : (D.diff(last, D.today()) >= 60
            ? "上次备份是 " + D.cn(last) + "，已经 " + D.diff(last, D.today()) + " 天了，该再导一份了。"
            : "上次备份：" + D.cn(last) + "，妥妥的。");
  }

  /* ── 某一天的弹层 ───────────────────────────── */
  /* ── 贴纸：她自己挑的图，缩到 240px 存成本地数据 ── */
  function renderSticker() {
    const data = state.settings.sticker;
    const hero = $("sticker");
    const prev = $("stickerPreview");
    [hero, prev].forEach((el) => {
      if (data) {
        el.src = data;
        el.hidden = false;
      } else {
        el.hidden = true;
        el.removeAttribute("src");
      }
    });
  }

  function pickSticker(file) {
    if (!file || !/^image\//.test(file.type)) { toast("要选一张图片哦"); return; }
    const fr = new FileReader();
    fr.onload = () => {
      const im = new Image();
      im.onload = () => {
        const max = 240;
        const scale = Math.min(1, max / Math.max(im.width, im.height));
        const w = Math.max(1, Math.round(im.width * scale));
        const h = Math.max(1, Math.round(im.height * scale));
        let data = "";
        try {
          const cv = document.createElement("canvas");
          cv.width = w; cv.height = h;
          cv.getContext("2d").drawImage(im, 0, 0, w, h);
          data = cv.toDataURL("image/png");
        } catch (e) { data = ""; }
        if (!data) { toast("这张图转换不了，换一张试试"); return; }
        if (data.length > 700000) { toast("图片有点大，换张小一点的吧"); return; }
        state.settings.sticker = data;
        save(true);
        renderSticker();
        toast("贴纸换好啦");
      };
      im.onerror = () => toast("这张图读不出来，换一张试试");
      im.src = String(fr.result);
    };
    fr.readAsDataURL(file);
  }

  /* ── 记录成功时蹦出来的小星星 ───────────────── */
  let burstTimer = null;
  function burst() {
    const box = $("burst");
    const marks = ["✦", "♥", "★", "✿", "♡", "✦", "★"];
    const colors = ["#FF7FA8", "#FFD75E", "#9BD1F2", "#A98CFF", "#57CE9B"];
    box.innerHTML = "";
    for (let i = 0; i < marks.length; i++) {
      const s = document.createElement("i");
      s.textContent = marks[i];
      s.style.left = (10 + Math.random() * 78) + "%";
      s.style.top = (48 + Math.random() * 22) + "%";
      s.style.color = colors[i % colors.length];
      s.style.animationDelay = (i * 45) + "ms";
      box.appendChild(s);
    }
    box.hidden = false;
    clearTimeout(burstTimer);
    burstTimer = setTimeout(() => { box.hidden = true; box.innerHTML = ""; }, 1500);
  }

  let sheetDate = null;
  let sheetDraft = null;

  function openSheet(dateStr) {
    sheetDate = dateStr;
    const log = dayLog(dateStr) || { flow: 0, symptoms: [], moods: [], note: "" };
    sheetDraft = {
      flow: log.flow || 0,
      symptoms: (log.symptoms || []).slice(),
      moods: (log.moods || []).slice()
    };
    $("sheetTitle").textContent = D.cn(dateStr) + " 周" + D.weekday(dateStr);
    $("sheetNote").value = log.note || "";
    renderSheetChips();
    $("sheetMask").hidden = false;
  }

  function renderSheetChips() {
    const f = $("sheetFlow");
    f.innerHTML = "";
    FLOWS.forEach((x) => f.appendChild(chip(x.label, sheetDraft.flow === x.v, () => {
      sheetDraft.flow = x.v;
      renderSheetChips();
    })));

    const s = $("sheetSymptoms");
    s.innerHTML = "";
    SYMPTOMS.forEach((n) => s.appendChild(chip(n, sheetDraft.symptoms.includes(n), () => {
      sheetDraft.symptoms = toggle(sheetDraft.symptoms, n);
      renderSheetChips();
    })));

    const mo = $("sheetMoods");
    mo.innerHTML = "";
    MOODS.forEach((n) => mo.appendChild(chip(n, sheetDraft.moods.includes(n), () => {
      sheetDraft.moods = toggle(sheetDraft.moods, n);
      renderSheetChips();
    })));
  }

  function closeSheet() {
    $("sheetMask").hidden = true;
    sheetDate = null;
    sheetDraft = null;
  }

  function saveSheet() {
    const dateStr = sheetDate;
    const draft = {
      flow: sheetDraft.flow,
      symptoms: sheetDraft.symptoms.slice(),
      moods: sheetDraft.moods.slice(),
      note: $("sheetNote").value.trim()
    };
    editDay(dateStr, (d) => {
      d.flow = draft.flow;
      d.symptoms = draft.symptoms;
      d.moods = draft.moods;
      d.note = draft.note;
    });
    const wasFlow = draft.flow > 0;
    invalidate();
    closeSheet();
    renderAll();
    toast("已保存 " + D.cn(dateStr) + (wasFlow ? "（已计入经期）" : ""));
    if (wasFlow) burst();
  }

  /* ── 导入 / 导出 ────────────────────────────── */
  function download(filename, text, mime) {
    const blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
  }

  function exportJson() {
    download("小月亮-备份-" + D.today() + ".json",
      JSON.stringify(state, null, 2), "application/json");
    state.settings.lastBackup = D.today();
    save(true);
    renderSettings();
    toast("备份已经导出");
  }

  function exportCsv() {
    const flowName = { 0: "无", 1: "少量", 2: "中量", 3: "大量" };
    const rows = [["日期", "流量", "身体感受", "心情", "备注"]];
    Object.keys(state.logs).sort().forEach((d) => {
      const l = state.logs[d];
      rows.push([d, flowName[l.flow] || "", (l.symptoms || []).join(" / "),
                 (l.moods || []).join(" / "), (l.note || "").replace(/[\r\n]+/g, " ")]);
    });
    const csv = "\uFEFF" + rows.map((r) =>
      r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(",")).join("\r\n");
    download("小月亮-记录-" + D.today() + ".csv", csv, "text/csv;charset=utf-8");
    toast("表格已经导出");
  }

  function importJson(file) {
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const data = JSON.parse(String(fr.result));
        if (!data || typeof data !== "object" || typeof data.logs !== "object") {
          throw new Error("格式不对");
        }
        const mine = Object.keys(state.logs).length;
        const theirs = Object.keys(data.logs).length;
        if (!confirm("导入会覆盖现在的记录（现在 " + mine + " 天，备份里 " + theirs +
                     " 天）。确定继续吗？")) return;
        state = Object.assign(defaults(), data);
        state.settings = Object.assign(defaults().settings, data.settings || {});
        state.logs = data.logs || {};
        save(true); invalidate(); applyTheme(); renderAll();
        toast("导入完成");
      } catch (e) {
        toast("这个文件读不出来，确认是导出的备份吗？");
      }
    };
    fr.readAsText(file);
  }

  /* ── 提前提醒 ───────────────────────────────── */
  function maybeNotify() {
    const s = state.settings;
    if (!s.notify || !("Notification" in window) || Notification.permission !== "granted") return;
    const m = model();
    if (m.daysUntil === null || m.inPeriod) return;
    if (m.daysUntil > s.leadDays || m.daysUntil < 0) return;
    const today = m.today;
    if (localStorage.getItem("xiaoyueliang.notified") === today) return;
    localStorage.setItem("xiaoyueliang.notified", today);
    const body = m.daysUntil === 0
      ? "预计就是今天，提前把用品准备好"
      : "还有 " + m.daysUntil + " 天，记得提前准备";
    try {
      new Notification("小月亮 · 经期快到了", { body: body, tag: "period-lead" });
    } catch (e) {
      /* 有些浏览器只允许在 Service Worker 里弹通知，不弹也不影响使用 */
    }
  }

  /* ── 渲染总入口 ─────────────────────────────── */
  function renderAll() {
    renderHome();
    renderCalendar();
    renderStats();
    renderSettings();
    renderSticker();
  }

  /* ── 事件绑定 ───────────────────────────────── */
  function switchView(name) {
    document.querySelectorAll(".tab").forEach((x) => {
      x.classList.toggle("is-active", x.dataset.view === name);
    });
    document.querySelectorAll(".view").forEach((v) => {
      v.classList.toggle("is-active", v.id === "view-" + name);
    });
    window.scrollTo({ top: 0 });
  }

  function shiftMonth(delta) {
    const ym = calMonth.split("-");
    const d = new Date(Number(ym[0]), Number(ym[1]) - 1 + delta, 1);
    calMonth = d.getFullYear() + "-" + pad(d.getMonth() + 1);
    renderCalendar();
  }

  function bind() {
    document.querySelectorAll(".tab").forEach((t) => {
      t.addEventListener("click", () => switchView(t.dataset.view));
    });

    $("btnTheme").addEventListener("click", () => {
      const order = ["auto", "light", "dark"];
      const next = order[(order.indexOf(state.settings.theme) + 1) % 3];
      state.settings.theme = next;
      save(true); applyTheme(); renderSettings();
      toast("外观：" + (next === "auto" ? "跟随系统" : next === "light" ? "浅色" : "深色"));
    });

    /* 首页快捷记录 */
    $("btnPeriodStart").addEventListener("click", () => {
      editDay(D.today(), (d) => { d.flow = 2; });
      invalidate(); renderAll();
      toast("记下了，今天是经期第 1 天");
      burst();
    });

    $("btnPeriodToday").addEventListener("click", () => {
      editDay(D.today(), (d) => { if (!d.flow) d.flow = 2; });
      invalidate(); renderAll();
      toast("今天接着记着");
      burst();
    });

    $("btnPeriodEnd").addEventListener("click", () => {
      if (!confirm("把今天从经期里去掉，也就是这次经期到昨天为止？")) return;
      editDay(D.today(), (d) => { d.flow = 0; });
      invalidate(); renderAll();
      toast("好，这次经期到昨天为止");
    });

    $("noteInput").addEventListener("input", () => {
      const v = $("noteInput").value;
      editDay(D.today(), (d) => { d.note = v.trim(); });
    });

    /* 日历 */
    $("calPrev").addEventListener("click", () => shiftMonth(-1));
    $("calNext").addEventListener("click", () => shiftMonth(1));
    $("calGrid").addEventListener("click", (e) => {
      const b = e.target.closest(".day");
      if (!b || !b.dataset.date) return;
      openSheet(b.dataset.date);
    });

    /* 弹层 */
    $("sheetClose").addEventListener("click", closeSheet);
    $("sheetSave").addEventListener("click", saveSheet);
    $("sheetMask").addEventListener("click", (e) => {
      if (e.target === $("sheetMask")) closeSheet();
    });
    $("sheetClear").addEventListener("click", () => {
      const d0 = sheetDate;
      if (!confirm("清除 " + D.cn(d0) + " 这一天的全部记录？")) return;
      delete state.logs[d0];
      save(true); invalidate(); closeSheet(); renderAll();
      toast("已清除");
    });

    /* 设置 */
    $("nameInput").addEventListener("input", () => {
      state.settings.name = $("nameInput").value.trim();
      save();
      renderHome();
    });
    $("autoCycle").addEventListener("change", () => {
      state.settings.autoCycle = $("autoCycle").checked;
      save(true); invalidate(); renderAll();
    });
    document.querySelectorAll(".step").forEach((b) => {
      b.addEventListener("click", () => {
        const key = b.dataset.step;
        const dir = Number(b.dataset.dir);
        const s = state.settings;
        if (key === "cycleLen") {
          s.cycleLength = clamp(s.cycleLength + dir, 20, 45);
          s.autoCycle = false;
        } else if (key === "periodLen") {
          s.periodLength = clamp(s.periodLength + dir, 2, 10);
        } else if (key === "leadDays") {
          s.leadDays = clamp(s.leadDays + dir, 0, 7);
        }
        save(true); invalidate(); renderAll();
      });
    });
    $("notifyOn").addEventListener("change", async () => {
      const on = $("notifyOn").checked;
      if (on && "Notification" in window && Notification.permission === "default") {
        let p = "denied";
        try { p = await Notification.requestPermission(); } catch (e) { p = "denied"; }
        if (p !== "granted") {
          $("notifyOn").checked = false;
          renderSettings();
          toast("浏览器没允许通知，可以到系统设置里打开");
          return;
        }
      }
      state.settings.notify = on;
      save(true);
      renderSettings();
      toast(on ? "会提前 " + state.settings.leadDays + " 天提醒你" : "已关掉提醒");
    });

    /* 数据 */
    $("btnExport").addEventListener("click", exportJson);
    $("btnExportCsv").addEventListener("click", exportCsv);
    $("btnImport").addEventListener("click", () => $("importFile").click());
    $("importFile").addEventListener("change", (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) importJson(f);
      e.target.value = "";
    });

    /* 贴纸 */
    $("btnStickerPick").addEventListener("click", () => $("stickerFile").click());
    $("stickerFile").addEventListener("change", (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) pickSticker(f);
      e.target.value = "";
    });
    $("btnStickerClear").addEventListener("click", () => {
      if (!state.settings.sticker) { toast("现在还没有贴纸"); return; }
      state.settings.sticker = "";
      save(true); renderSticker();
      toast("贴纸去掉了");
    });

    $("btnWipe").addEventListener("click", () => {
      if (!confirm("确定清空全部记录吗？清掉就找不回来了，建议先导出备份。")) return;
      state = defaults();
      save(true); invalidate(); applyTheme(); renderAll();
      toast("已清空");
    });

    window.matchMedia("(prefers-color-scheme: dark)")
      .addEventListener("change", () => {
        if (state.settings.theme === "auto") applyTheme();
      });
  }

  /* ── 启动 ───────────────────────────────────── */
  function boot() {
    load();
    applyTheme();
    bind();
    renderAll();
    maybeNotify();

    /* 申请「持久化存储」：这样浏览器在空间紧张时不会顺手把她的记录清掉。*/
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(() => {});
    }

    if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  /* 调试用把手：方便在浏览器控制台、或自动化检查里直接验证推算结果。 */
  window.xyDebug = {
    D: D,
    model: model,
    predict: predict,
    invalidate: invalidate,
    derivePeriods: derivePeriods,
    getState: function () { return state; },
    setState: function (s) { state = s; invalidate(); }
  };
})();
