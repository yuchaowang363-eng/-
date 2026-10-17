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
  const CRAMPS   = [
    { v: 0, label: "不痛" },
    { v: 1, label: "有点" },
    { v: 2, label: "明显" },
    { v: 3, label: "很痛" }
  ];

  const PHASE_META = {
    menstrual:  { name: "经期",     color: "--menstrual"  },
    follicular: { name: "卵泡期",   color: "--follicular" },
    ovulation:  { name: "排卵期",   color: "--ovulation"  },
    luteal:     { name: "黄体期",   color: "--luteal"     },
    overdue:    { name: "已推迟",   color: "--danger"     },
    unknown:    { name: "还没数据", color: "--text-3"     }
  };

  /* 小提示：先看她今天记了什么，再按周期位置补位。
     每条都是「一句人话 + 具体做法 + 为什么」，需要时再加一句「什么时候该看医生」。
     内容取自公认的做法（热敷、NSAIDs、补铁、睡眠卫生等），是通用建议，不替代就诊。
     同一类准备了两条，按日期轮换，不会连着两天说同一句。*/
  const TIP_BANK = {
    crampsMild: [
      { t: "有点闷的时候，热敷比硬扛管用。",
        p: ["热水袋放小腹 15–20 分钟，隔着衣服别烫到。", "少喝冰的，起来走几分钟反而更松。"],
        w: "温热能让子宫平滑肌放松、局部血流变好；有研究显示热敷缓解痛经的效果和布洛芬接近。" },
      { t: "轻轻疼的时候，先别急着吃药。",
        p: ["热敷 + 慢慢走一走，比一直蜷着好受。", "注意保暖，尤其腰腹和脚。"],
        w: "受凉会让局部血管收缩、子宫收缩更明显，所以保暖是真的有用。" }
    ],
    cramps: [
      { t: "疼起来别忍，热敷加止痛药是标准做法。",
        p: ["先热敷 15–20 分钟；还疼可以吃布洛芬，饭后吃、按说明书剂量。", "止痛药在刚开始疼时吃，比疼到受不了再吃更有效。"],
        w: "原发性痛经主要是前列腺素让子宫强烈收缩，布洛芬这类药正是抑制前列腺素合成的。",
        s: "如果每次都要请假、吃药也压不住，建议去妇科查一下。" },
      { t: "今天可以给自己减点任务。",
        p: ["把要紧的事推一推，疼的时候硬撑效率更低。", "侧躺、膝盖之间夹个枕头，腰会松一点。"],
        w: "经期第一天前列腺素最高，扛着做事反而更累。",
        s: "疼得越来越重、或吃药也不管用，建议去妇科看看。" }
    ],
    crampsSevere: [
      { t: "疼到这个程度，先别撑着做事了。",
        p: ["热敷同时可以用止痛药（布洛芬等，饭后、按说明书）。", "侧躺屈膝、肚子垫个热水袋，能减少牵拉。"],
        w: "疼到影响正常活动，说明前列腺素水平偏高，单纯忍着没有意义。",
        s: "反复这么疼、或伴随发烧、异常出血，尽快看医生，排查子宫内膜异位症等。" },
      { t: "这种痛不需要你证明能忍。",
        p: ["该吃药吃药，该躺就躺。", "如果已经影响到上班上学，把日子记下来，去看医生时有依据。"],
        w: "记录疼痛的日期和程度，医生判断会准很多。",
        s: "反复这么疼、或伴随发烧、异常出血，尽快看医生。" }
    ],
    heavy: [
      { t: "量多这天，重点是别硬省。",
        p: ["1–2 小时换一次，夜用或加长款更安心。", "多吃含铁食物：红肉、动物肝脏、深绿叶菜，配点维C。"],
        w: "经血会带走铁，量大的日子容易头晕、乏力。",
        s: "每小时就要换、经期超过 7 天、或有大量血块，建议查血常规和妇科。" },
      { t: "量多的日子，别久站。",
        p: ["起身慢一点，站久了容易眼前发黑。", "多喝水，别因为不方便就少喝。"],
        w: "血量多时血压容易波动，起身太快会头晕。",
        s: "每小时就要换、经期超过 7 天、或有大血块，建议查一下。" }
    ],
    sleep: [
      { t: "睡不着别硬躺，越躺越焦虑。",
        p: ["起来喝口温水，等困了再回床上；别看手机。", "明天固定时间起床，别用补觉把节律拖乱。"],
        w: "经前体温会略升、孕激素下降，本来就更容易睡不踏实。",
        s: "连续几周睡不好、白天撑不住，可以问问医生。" },
      { t: "今晚早点关灯吧。",
        p: ["睡前 1 小时不刷手机，房间调凉一点。", "下午之后少喝咖啡和浓茶。"],
        w: "体温降一点人才容易入睡，经前体温偏高，更需要凉一点的环境。" }
    ],
    mood: [
      { t: "情绪起伏不是你的问题。",
        p: ["出去走 20 分钟、晒会儿太阳，比闷在屋里管用。", "这几天少做重大决定，也别急着证明自己没事。"],
        w: "经前雌激素和孕激素一起下降，会影响血清素，情绪跟着晃是生理反应。",
        s: "如果每个月都有几天完全无法正常生活，可能是 PMDD，值得看医生。" },
      { t: "烦就烦一会儿，不用马上好起来。",
        p: ["找个人说两句，或者写下来，别都憋着。", "想哭就哭，哭完通常会松一点。"],
        w: "情绪被说出来之后，身体的紧张反应会下降。",
        s: "如果每个月都有几天完全撑不住，可能是 PMDD，值得看医生。" }
    ],
    tired: [
      { t: "累是真的累，不是懒。",
        p: ["能睡就睡，20 分钟小睡也有用。", "别空腹太久，吃点蛋白质：鸡蛋、牛奶、豆制品。"],
        w: "经期失血加上前列腺素升高，本来就更容易疲惫。" },
      { t: "今天把力气省着用。",
        p: ["把不着急的事往后放。", "久坐之后起来活动两分钟，比一直瘫着提神。"],
        w: "轻度活动能促进循环，反而没那么困。" }
    ],
    appetite: [
      { t: "嘴馋是激素在推你，不是意志力差。",
        p: ["规律吃三餐、加一点蛋白质，血糖稳了反而没那么想吃甜。", "真想吃就吃一小份，别用饿来对抗。"],
        w: "黄体期基础代谢会略升，血清素下降也会让人更想吃碳水。" },
      { t: "想吃甜的，就吃点，别自责。",
        p: ["配点坚果或酸奶，血糖不会一下冲太高。", "别在饿的时候逛超市，容易买多。"],
        w: "经前对甜食的渴望是很常见的生理现象。" }
    ],
    breast: [
      { t: "胀痛这几天，换件支撑好一点的内衣。",
        p: ["减少咖啡因和高盐食物，热敷也有帮助。", "晚上可以穿宽松的无钢圈内衣睡。"],
        w: "黄体期水钠潴留、乳腺组织充血，经后通常会自己缓解。",
        s: "摸到明显硬块、或只有单侧固定一点疼，建议去查。" },
      { t: "胀就少碰，别一直揉。",
        p: ["温水淋浴、宽松衣服会舒服些。", "这几天少喝咖啡和浓茶。"],
        w: "咖啡因可能加重乳房胀痛，很多人试过有效。",
        s: "摸到明显硬块、或单侧固定一点疼，建议去查。" }
    ],
    digest: [
      { t: "肚子不舒服，先吃清淡的。",
        p: ["腹泻时补水和电解质，别喝冰的、别吃太油。", "便秘就多喝水、多吃蔬菜，别硬憋。"],
        w: "前列腺素也会作用在肠道上，经期拉肚子或便秘都很常见。" },
      { t: "肠胃闹脾气的时候，别硬吃。",
        p: ["少量多餐，热的、软的优先。", "如果拉得很厉害，注意补点盐分。"],
        w: "经期肠道蠕动会变快或变慢，都是激素在影响。" }
    ],
    periodDay1: [
      { t: "第一天，最难熬的通常是今天。",
        p: ["热敷 + 少安排事，能躺就躺。", "吃点含铁的东西，别空腹。"],
        w: "第一天前列腺素水平最高、子宫收缩最强，疼和量大都集中在这天。" },
      { t: "开始了，今天对自己好一点。",
        p: ["热水袋、热饮提前备好。", "别熬夜，睡够了痛感会轻一些。"],
        w: "睡眠不足会降低痛阈，同样的疼会觉得更疼。" }
    ],
    periodMiddle: [
      { t: "量最多的这两天，别久站。",
        p: ["1–2 小时换一次，勤换比省着用更卫生。", "久站容易头晕，坐下时把腿抬高一点。"],
        w: "经血多的时候站久了容易脑供血不足、眼前发黑。" },
      { t: "还在经期里，节奏放慢点。",
        p: ["今天少喝冰的、别熬夜。", "洗澡用温水，别泡太久。"],
        w: "经期宫颈口微开，温水淋浴比泡澡更稳妥。" }
    ],
    periodEnd: [
      { t: "快结束了，别急着恢复强度。",
        p: ["再观察一天，量明显减少再恢复运动。", "这几天可以开始补铁、早点睡，把状态养回来。"],
        w: "经期最后几天内膜还在修复，剧烈运动容易又出血。" },
      { t: "这次快过完啦。",
        p: ["把这几天的记录补一补，下次预测会更准。", "换洗床单内衣，给自己一个清爽的开始。"],
        w: "记录越完整，下一次的预测和提醒就越贴合你。" }
    ],
    follicular: [
      { t: "状态在回来了，可以给自己加点事。",
        p: ["适合安排需要精力的活，也可以开始规律运动。", "补铁、补蛋白，为下一次经期存点底。"],
        w: "雌激素上升，体力和情绪通常在这几天最好。" },
      { t: "这几天身体最舒展。",
        p: ["想运动就动起来，量力而行。", "把难啃的事情安排在这几天。"],
        w: "卵泡期恢复力好，运动后不容易那么累。" }
    ],
    ovulation: [
      { t: "排卵前后，身体会有一些细小的变化。",
        p: ["分泌物变透明、能拉丝是正常的，注意清洁就好。", "基础体温会升 0.2–0.5°C，别当成发烧。"],
        w: "排卵后黄体开始分泌孕激素，体温随之升高。",
        s: "如果排卵期疼得厉害或出血量多，建议查一下。" },
      { t: "这几天可能会有点小腹坠胀。",
        p: ["一侧下腹短暂刺痛，几分钟到一两天都常见。", "疼得明显就休息一下，别硬撑。"],
        w: "排卵时卵泡破裂、少量液体刺激腹膜，会有经间痛。" }
    ],
    luteal: [
      { t: "经前这一周，对自己松一点。",
        p: ["少盐、多喝水，水肿会轻一些；这几天别称体重。", "早点睡、少熬夜，PMS 会明显轻一点。"],
        w: "黄体期孕激素高、血清素低，水肿、嘴馋、情绪起伏都在这时候。" },
      { t: "经前涨的那一两斤，是水。",
        p: ["少盐、多喝水，反而排得更顺。", "别在这几天做体重计划，容易被数字影响心情。"],
        w: "水钠潴留会在经后自然消退，不是长胖。" }
    ],
    overdue: [
      { t: "推迟几天，先别自己吓自己。",
        p: ["回想最近有没有熬夜、压力大、生病、体重变化。", "推迟 7 天内很常见；超过 10 天建议验孕或看医生。"],
        w: "周期受下丘脑—垂体—卵巢轴调节，压力、睡眠、体重都会影响排卵时间。" },
      { t: "晚几天不代表出问题。",
        p: ["先排除怀孕，再观察几天。", "如果连续几个周期都乱，记下来给医生看。"],
        w: "偶尔一次推迟很常见，连续紊乱才更需要关注。" }
    ],
    countdown: [
      { t: "快到了，提前准备比临时抓瞎好。",
        p: ["包里放一片，家里备好夜用和热水袋。", "这两天注意保暖、别熬夜，经期会好过一点。"],
        w: "经前受凉和睡眠不足，会让前列腺素反应更明显、痛经更重。" },
      { t: "这两天可能会有点预兆。",
        p: ["乳房胀、腰酸、情绪低，都可能是要来了。", "把重要安排错开那几天，会轻松很多。"],
        w: "经前症状通常在来潮前 3–7 天最明显。" }
    ],
    due: [
      { t: "预计就是今天，先别慌。",
        p: ["提前把要用的东西放好，出门带一片。", "今天别安排太满，给自己留点余地。"],
        w: "预测是按你过去的周期长度算的，前后差一两天很正常。" },
      { t: "到日子了，今天出门带一片。",
        p: ["内裤、包里各放一片，省得临时找。", "感觉来了就记一下，别等想起来才补。"],
        w: "越早记录开始日，下一次的预测越准。" }
    ],
    empty: [
      { t: "先记一次「经期来了」，我就知道从哪里开始算了。",
        p: ["只点开始和结束两下就行，中间不用天天填。", "记满两三次，预测就会越来越准。"],
        w: "周期长度是拿相邻两次开始日的间隔算的。" },
      { t: "记一次就够，不用天天打卡。",
        p: ["来的时候点一下，走的时候点一下。", "身体感受想记就记，不记也不影响预测。"],
        w: "模型只依赖开始日，记录负担越轻越容易坚持。" }
    ]
  };

  function seedOf(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  /* 同一类里按日期轮换；如果跟昨天算出来的是同一条，就往后挪一位 */
  function pickTip(list, key) {
    if (!list || !list.length) return null;
    let i = seedOf(key + "|" + D.today()) % list.length;
    if (list.length > 1) {
      const y = seedOf(key + "|" + D.add(D.today(), -1)) % list.length;
      if (i === y) i = (i + 1) % list.length;
    }
    return list[i];
  }

  function tipFor(m) {
    const log = dayLog(m.today) || {};
    const sym = log.symptoms || [];
    const moods = log.moods || [];
    const any = (arr, names) => names.some((n) => arr.indexOf(n) >= 0);
    const cramps = log.cramps || 0;
    const flow = log.flow || 0;

    /* 先看她今天记了什么，说得越具体越像有人在旁边 */
    if (cramps >= 3) return pickTip(TIP_BANK.crampsSevere, "crampsSevere");
    if (cramps >= 2) return pickTip(TIP_BANK.cramps, "cramps");
    if (cramps >= 1) return pickTip(TIP_BANK.crampsMild, "crampsMild");
    if (any(sym, ["失眠"])) return pickTip(TIP_BANK.sleep, "sleep");
    if (any(moods, ["烦躁", "低落", "焦虑", "敏感", "想哭"])) return pickTip(TIP_BANK.mood, "mood");
    if (any(sym, ["头痛", "疲惫", "嗜睡"])) return pickTip(TIP_BANK.tired, "tired");
    if (any(sym, ["食欲大增"])) return pickTip(TIP_BANK.appetite, "appetite");
    if (any(sym, ["乳房胀痛"])) return pickTip(TIP_BANK.breast, "breast");
    if (any(sym, ["腹泻", "便秘"])) return pickTip(TIP_BANK.digest, "digest");
    if (flow >= 3) return pickTip(TIP_BANK.heavy, "heavy");

    if (!m.lastStart) return pickTip(TIP_BANK.empty, "empty");

    if (m.inPeriod) {
      const n = m.dayOfPeriod;
      if (n <= 1) return pickTip(TIP_BANK.periodDay1, "p1");
      if (n >= Math.max(3, m.periodLength - 1)) return pickTip(TIP_BANK.periodEnd, "pEnd");
      return pickTip(TIP_BANK.periodMiddle, "pMid");
    }
    if (m.daysUntil === 0) return pickTip(TIP_BANK.due, "due");
    if (m.daysUntil !== null && m.daysUntil > 0 && m.daysUntil <= 3) {
      return pickTip(TIP_BANK.countdown, "count");
    }
    if (TIP_BANK[m.phase]) return pickTip(TIP_BANK[m.phase], m.phase);
    return pickTip(TIP_BANK.empty, "empty");
  }

  /* 三层结构：一句人话 → 具体做法 → 为什么；需要时再加一句「要留意」 */
  function renderTip(m) {
    const tip = tipFor(m);
    const box = $("tipBody");
    if (!box) return;
    if (!tip) { box.innerHTML = ""; return; }
    box.innerHTML =
      '<p class="tip-title">' + tip.t + "</p>" +
      '<ul class="tip-points">' +
        tip.p.map((x) => "<li>" + x + "</li>").join("") +
      "</ul>" +
      (tip.w ? '<p class="tip-why"><b>为什么</b>' + tip.w + "</p>" : "") +
      (tip.s ? '<p class="tip-see"><b>要留意</b>' + tip.s + "</p>" : "");
  }

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
    v: 2,
    settings: {
      name: "",
      autoCycle: true,
      cycleLength: 28,
      periodLength: 5,
      notify: false,
      leadDays: 2,
      theme: "auto",
      sticker: "",         // 她自己上传的贴纸（data URL，只存在本地）
      lastBackup: "",      // 上次导出备份的日期，用来提醒她别一直不备份
      snoozeUntil: ""      // 「还没结束」按过之后，当天不再追问
    },
    logs: {},              // 每天的可选细节（流量、痛经、症状、心情、备注）
    periods: []            // 经期区间 [{start, end|null}]，是"在不在经期"的唯一依据
  });

  let state = defaults();

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      state = upgrade(parsed);
    } catch (e) {
      console.warn("读取本地数据失败，先用空数据", e);
    }
  }

  /* v1 的做法是「哪天的流量大于 0，哪天就算在经期里」，逼着人天天点。
     现在改成记「开始日 + 结束日」的区间，中间自动补上，点两下就够。
     这里把老数据搬过来，尽量还原成区间，别让她以前的记录白记。*/
  function upgrade(old) {
    const s = Object.assign(defaults(), old);
    s.settings = Object.assign(defaults().settings, old.settings || {});
    s.logs = old.logs || {};
    s.periods = Array.isArray(old.periods)
      ? normalizePeriods(old.periods)
      : periodsFromFlowLogs(s.logs);
    s.v = 2;
    return s;
  }

  function periodsFromFlowLogs(logs) {
    const days = Object.keys(logs)
      .filter((d) => logs[d] && logs[d].flow > 0)
      .sort();
    const out = [];
    for (const d of days) {
      const last = out[out.length - 1];
      const near = last && D.diff(last.end, d) <= 2 && D.diff(last.start, d) + 1 <= 12;
      if (near) last.end = d;
      else out.push({ start: d, end: d });
    }
    return out;
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
    const cur = state.logs[dateStr] || { flow: 0, cramps: 0, symptoms: [], moods: [], note: "" };
    fn(cur);
    const empty = !cur.flow && !cur.cramps && !(cur.symptoms || []).length &&
                  !(cur.moods || []).length && !(cur.note || "").trim();
    if (empty) delete state.logs[dateStr];
    else state.logs[dateStr] = cur;
    save();
  }

  /* ── 周期推算 ───────────────────────────────── */
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

  /* 经期记成「一段一段」的区间：开始日 + 结束日，中间那些天自动算在里面。
     所以只要点两下——来的时候点一下，走的时候点一下，不用天天打卡。 */
  const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
  /* 只把「紧挨着的两天」当作同一次的误点合并。
     不能再放宽：她要是明确把中间某天从经期里拿掉，我们就该老实拆成两段，
     阈值一大就又粘回去了——等于她的操作白做。*/
  const MERGE_GAP = 1;

  function normalizePeriods(list) {
    const clean = [];
    for (const p of (list || [])) {
      if (!p || !isDate(p.start)) continue;
      /* 经期不可能发生在未来。导入的备份被人手动改过、或者时区跳变，
         都可能留下这种日期，留着会算出一个负数的「周期第几天」。*/
      if (p.start > D.today()) continue;
      clean.push({
        start: p.start,
        end: (isDate(p.end) && p.end >= p.start) ? p.end : null
      });
    }
    clean.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));

    const out = [];
    for (const p of clean) {
      const last = out[out.length - 1];
      if (!last) { out.push(p); continue; }
      if (D.diff(last.end || last.start, p.start) <= MERGE_GAP) {
        /* 挨太近，是同一次：结束日取更晚的；只要有一段没结束，整段就没结束 */
        if (!p.end) last.end = null;
        else if (last.end && p.end > last.end) last.end = p.end;
        continue;
      }
      /* 上一段还挂着"没结束"，而下一段又开始了 → 它其实早就结束了。
         结束日取「按她平常的经期长度假定」和「下一段开始的前一天」里更早的那个，
         不然忘点一次结束，就会攒出一个 40 天的假经期，把平均值带歪。*/
      if (!last.end) {
        const assumed = D.add(last.start, Math.max(1, state.settings.periodLength) - 1);
        const beforeNext = D.add(p.start, -1);
        last.end = assumed < beforeNext ? assumed : beforeNext;
      }
      out.push(p);
    }
    /* 结束日不许越过下一段的开始日 */
    for (let i = 0; i < out.length - 1; i++) {
      const next = out[i + 1].start;
      if (out[i].end && out[i].end >= next) out[i].end = D.add(next, -1);
      if (out[i].end && out[i].end < out[i].start) out[i].end = out[i].start;
    }
    return out;
  }

  const periods = () => normalizePeriods(state.periods);

  /* 一段还没点「结束」的经期，默认到今天都还算在经期里。
     但拖得太久就多半是忘了点，按她平常的经期长度收尾，
     免得首页一直挂着「经期第 30 天」、也免得「经期来了」按钮点了没反应。
     这个判断必须和 model() 里的一致，两边只要不一致就会出现「按了没反应」。*/
  const staleLimit = () => Math.max(15, state.settings.periodLength + 8);
  function effectiveEnd(p) {
    if (p.end) return p.end;
    const today = D.today();
    if (D.diff(p.start, today) + 1 > staleLimit()) {
      return D.add(p.start, Math.max(1, state.settings.periodLength) - 1);
    }
    return today;
  }

  function periodAt(dateStr) {
    const list = periods();
    return list.filter((p) => dateStr >= p.start && dateStr <= effectiveEnd(p)).pop() || null;
  }

  /* 这天算不算在经期里 */
  function dayInPeriod(dateStr) {
    return periods().some((p) => dateStr >= p.start && dateStr <= effectiveEnd(p));
  }

  /* 把这天定为一次经期的开始 */
  function markPeriodStart(dateStr) {
    if (dateStr > D.today()) { toast("还没到那天呢，到时候再记"); return false; }
    if (dayInPeriod(dateStr)) { toast("这天已经在经期里了"); return false; }
    state.periods = normalizePeriods(periods().concat([{ start: dateStr, end: null }]));
    save(true);
    invalidate();
    return true;
  }

  /* 把这天定为一次经期的最后一天 */
  function markPeriodEnd(dateStr) {
    if (dateStr > D.today()) { toast("还没到那天呢，到时候再记"); return false; }
    const list = periods();
    const before = list.filter((p) => p.start <= dateStr);
    if (!before.length) { toast("这天之前还没有经期记录"); return false; }
    const later = list.find((p) => p.start > dateStr);
    if (later) { toast("这天之后还有一次经期记录，先处理那一段"); return false; }
    before[before.length - 1].end = dateStr;
    state.periods = normalizePeriods(list);
    save(true);
    invalidate();
    return true;
  }

  /* 把这天从经期里拿掉（在中间拿掉就把这段拆成两段） */
  function clearPeriodDay(dateStr) {
    const list = periods();
    const i = list.findIndex((p) => dateStr >= p.start && dateStr <= (p.end || dateStr));
    if (i < 0) return false;
    const p = list[i];
    const parts = [];
    if (D.diff(p.start, dateStr) > 0) parts.push({ start: p.start, end: D.add(dateStr, -1) });
    if (p.end && p.end > dateStr) parts.push({ start: D.add(dateStr, 1), end: p.end });
    /* 进行中的那一段被挖掉中间某天时，后面的日子要留下来继续算「进行中」。
       原来这里把条件写反了，会连今天及之后的日子一起吞掉。*/
    else if (!p.end && dateStr < D.today()) parts.push({ start: D.add(dateStr, 1), end: null });
    list.splice(i, 1);
    state.periods = normalizePeriods(list.concat(parts));
    save(true);
    invalidate();
    return true;
  }

  let modelCache = null;
  const invalidate = () => { modelCache = null; };

  function model() {
    /* 只认「今天」的缓存：App 挂着过了午夜，或者切到后台第二天再回来，
       不能还拿昨天算出来的「经期第 N 天」。*/
    if (modelCache && modelCache.today === D.today()) return modelCache;
    const s = state.settings;
    const list = periods();
    const starts = list.map((p) => p.start);

    /* 周期长度 = 相邻两次开始日的间隔。
       小于 10 天多半是误点出来的，大于 90 天多半是漏记，都不参与平均。*/
    const gaps = [];
    for (let i = 1; i < starts.length; i++) {
      const g = D.diff(starts[i - 1], starts[i]);
      if (g >= 10 && g <= 90) gaps.push(g);
    }
    const learnedCycle = gaps.length ? Math.round(mean(gaps)) : null;
    const cycleLength = (s.autoCycle && learnedCycle) ? learnedCycle : s.cycleLength;

    /* 经期长度：只有记录得比较完整（至少 3 天）时才采信实测值。*/
    const measured = list.filter((p) => p.end).map((p) => D.diff(p.start, p.end) + 1);
    const avgMeasured = measured.length ? mean(measured) : 0;
    const measuredPeriod = avgMeasured >= 3 ? Math.round(avgMeasured) : null;
    const periodLength = measuredPeriod || s.periodLength;

    const today = D.today();

    /* 还没点「结束」的那一段：默认到今天都还算在经期里。
       但要是拖了太久（多半是忘了点），就按设置的经期长度收尾，
       免得首页一直挂着「经期第 30 天」这种荒唐数字。*/
    const openPeriod = list.find((p) => !p.end && p.start <= today) || null;
    const openDays = openPeriod ? D.diff(openPeriod.start, today) + 1 : 0;
    const openStale = !!(openPeriod && openDays > staleLimit());

    const lastStart = starts.length ? starts[starts.length - 1] : null;
    const nextDue = lastStart ? D.add(lastStart, cycleLength) : null;
    const dayOfCycle = lastStart ? D.diff(lastStart, today) + 1 : null;
    const daysUntil = nextDue ? D.diff(today, nextDue) : null;

    /* 排卵日一般在下次经期前 14 天；易孕窗口取排卵前 5 天到排卵后 1 天。*/
    const ovulationDay = Math.max(8, cycleLength - 14);
    const fertileFrom = Math.max(1, ovulationDay - 5);
    const fertileTo = ovulationDay + 1;

    const closedHit = list.filter((p) => p.end && today >= p.start && today <= p.end).pop() || null;
    const currentPeriod = (!openStale && openPeriod) || closedHit;
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
      periods: list, starts, gaps, learnedCycle, cycleLength, periodLength, measuredPeriod, lastStart,
      nextDue, dayOfCycle, daysUntil, ovulationDay, fertileFrom, fertileTo,
      inPeriod, dayOfPeriod, phase, today,
      openPeriod, openDays, openStale, currentPeriod
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
    const ahead = off > m.cycleLength ? Math.floor((off - 1) / m.cycleLength) : 0;
    if (ahead > 0) off -= ahead * m.cycleLength;
    /* 本周期这一段要是已经点了「结束」，后面那几天就不是经期了，
       不能再按"预计还要来几天"往后涂。只有还挂着没结束的那段才补后续天数。*/
    const ongoing = !!(m.openPeriod && !m.openStale);
    if (off <= m.periodLength && (ahead > 0 || ongoing)) res.predicted = true;
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
      const cur = m.currentPeriod;
      num = n; unit = "天";
      line = "正在经期中";
      if (cur && cur.end) {
        /* 结束日已经写死了，就别再说「大概」 */
        const left = Math.max(0, D.diff(m.today, cur.end));
        sub = "记录到 " + D.cn(cur.end) + (left > 0 ? " · 还有 " + left + " 天" : " · 就是今天");
      } else {
        const left = Math.max(0, m.periodLength - n);
        sub = left > 0
          ? "按平常大概还有 " + left + " 天 · 结束了点一下按钮"
          : (n > m.periodLength
              ? "比平常的 " + m.periodLength + " 天长了，结束了吗？"
              : "这次差不多要结束了");
      }
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
    renderBanner();
    renderToday();
  }

  /* 补记前几天：胸痛、腰酸这些往往是回头才想起来的，
     所以给一排「昨天 / 前天 / …」的快捷入口，不用特地去翻日历。*/
  function renderCatchup() {
    const box = $("catchup");
    box.innerHTML = "";
    const t = model().today;
    for (let i = 1; i <= 6; i++) {
      const ds = D.add(t, -i);
      const label = i === 1 ? "昨天" : i === 2 ? "前天" : i + " 天前";
      const logged = !!state.logs[ds];
      box.appendChild(chip(label + (logged ? " ✓" : ""), false, () => openSheet(ds)));
    }
  }

  function renderQuick() {
    const m = model();
    const start = $("btnPeriodStart"), end = $("btnPeriodEnd"), note = $("quickNote");
    const show = (el, on) => { el.style.display = on ? "" : "none"; };
    const cur = m.currentPeriod;
    /* 页面和脚本版本短暂错开时（比如离线缓存只更新了一半），少一个元素不该让整页崩掉 */
    const setNote = (text) => {
      if (!note) return;
      note.textContent = text || "";
      note.hidden = !text;
    };

    /* 一个周期只需要点两次：来的时候点一下，走的时候点一下。
       中间那些天由区间自动带上，不用天天打卡。
       今天正好是记录里的最后一天时，就不再摆「经期结束了」——
       点了不会有任何变化，反而让人以为没记上。*/
    if (m.inPeriod && cur && !cur.end) {
      show(start, false);
      show(end, true);
      end.className = "btn btn-primary";
      end.textContent = "经期结束了";
      setNote("");
    } else if (m.inPeriod && cur) {
      show(start, false);
      show(end, false);
      setNote("这次经期记到 " + D.cn(cur.end) + "，共 " +
        (D.diff(cur.start, cur.end) + 1) + " 天。");
    } else {
      show(start, true);
      start.textContent = "经期来了";
      show(end, false);
      end.className = "btn btn-soft";
      setNote("");
    }
  }

  /* 忘了点「结束」时，隔几天轻轻问一句，别一直挂着 */
  function renderBanner() {
    const m = model();
    const box = $("periodBanner");
    const ask = !!(m.openPeriod && m.openDays > m.periodLength + 2 &&
                   state.settings.snoozeUntil !== m.today);
    if (!ask) { box.hidden = true; return; }
    box.hidden = false;
    $("bannerText").textContent = "这次经期已经第 " + m.openDays + " 天了，结束了吗？" +
      (m.openStale ? "（还没点结束，我先按 " + m.periodLength + " 天算的）" : "");
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
        /* 现在「在不在经期」由区间决定，光填流量不会改日历。
           所以填了中量/大量而这天又不在经期里时，轻轻提示一句，免得她以为记上了。*/
        if (f.v >= 2 && !dayInPeriod(t)) {
          toast("记下了。这天还不算经期——要算的话，去日历点「这天来经期了」");
        }
      }));
    });

    const cBox = $("crampChips");
    cBox.innerHTML = "";
    CRAMPS.forEach((c) => {
      cBox.appendChild(chip(c.label, (log.cramps || 0) === c.v, () => {
        editDay(t, (d) => { d.cramps = c.v; });
        renderToday();
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

    renderCatchup();
    /* 提示读的就是「今天的记录」，所以每次重画这一块都要跟着更新——
       放在 renderToday 里，点任何一个症状/心情胶囊都会立刻生效。*/
    renderTip(model());
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
      const actual = dayInPeriod(ds);
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
      const row = document.createElement("div");
      row.className = "hist-row";
      row.innerHTML =
        "<span>" + D.cn(p.start) + (p.end && p.end !== p.start ? " – " + D.cn(p.end) : "") + "</span>" +
        '<span class="grow">' + (p.end ? (D.diff(p.start, p.end) + 1) + " 天" : "进行中") +
        (gap && gap >= 10 && gap <= 90 ? " · 周期 " + gap + " 天" : "") + "</span>";
      box.appendChild(row);
    });
  }

  /* ── 统计 ───────────────────────────────────── */
  /* 身体感受最常出现在周期的哪几天。
     她提过「胸痛一般都在来之前」——这个分析就是拿她自己的记录回答这句话。*/
  function symptomPatterns() {
    const m = model();
    if (!m.starts.length) return [];
    const buckets = {};
    for (const d of Object.keys(state.logs)) {
      const log = state.logs[d];
      if (!log || !(log.symptoms || []).length) continue;
      let base = null;
      for (const s0 of m.starts) { if (s0 <= d) base = s0; else break; }
      if (!base) continue;
      const off = D.diff(base, d) + 1;
      if (off < 1 || off > 45) continue;
      for (const sym of log.symptoms) (buckets[sym] = buckets[sym] || []).push(off);
    }
    const out = [];
    for (const name of Object.keys(buckets)) {
      const days = buckets[name];
      if (days.length < 2) continue;
      out.push({ name: name, times: days.length, win: bestWindow(days, m.cycleLength) });
    }
    out.sort((a, b) => b.times - a.times);
    return out.slice(0, 6);
  }

  /* 找一个 3 天宽的窗口，让落进去的记录最多 */
  function bestWindow(days, cycleLength) {
    let best = { from: 1, count: 0 };
    const span = Math.max(4, Math.min(cycleLength || 28, 40));
    for (let w = 1; w <= span; w++) {
      const c = days.filter((x) => x >= w && x <= w + 2).length;
      if (c > best.count) best = { from: w, count: c };
    }
    return best;
  }

  function whenLabel(day, m) {
    if (day <= m.periodLength) return "（经期中）";
    if (Math.abs(day - m.ovulationDay) <= 1) return "（排卵前后）";
    if (day < m.ovulationDay) return "（排卵前）";
    return "（经期前）";
  }

  function renderStats() {
    const m = model();
    const row = $("statRow");
    /* 没有实测数据时就显示「—」，不要拿设置里的默认值冒充她自己的平均值。*/
    const cards = [
      { v: m.learnedCycle === null ? "—" : m.learnedCycle, u: "天", k: "平均周期" },
      { v: m.measuredPeriod === null ? "—" : m.measuredPeriod, u: "天", k: "平均经期" },
      { v: m.gaps.length
            ? (Math.min.apply(null, m.gaps) === Math.max.apply(null, m.gaps)
                ? String(m.gaps[0])
                : Math.min.apply(null, m.gaps) + "–" + Math.max.apply(null, m.gaps))
            : "—",
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

    /* 身体感受的规律 */
    const pbox = $("symptomPatterns");
    pbox.innerHTML = "";
    const pats = symptomPatterns();
    if (!pats.length) {
      pbox.innerHTML = '<p class="empty">同一类感受记满两次，就能看出它爱在哪几天出现。</p>';
      $("patternHint").textContent = "";
    } else {
      pats.forEach((p) => {
        const mid = p.win.from + 1;
        const row = document.createElement("div");
        row.className = "hist-row";
        row.innerHTML = "<span>" + p.name + "</span>" +
          '<span class="grow">' + p.times + " 次 · 多在周期第 " + p.win.from + "–" +
          (p.win.from + 2) + " 天" + whenLabel(mid, model()) + "</span>";
        pbox.appendChild(row);
      });
      $("patternHint").textContent = "「周期第几天」从每次经期的第一天开始数，这样就知道它是在经期前还是经期后。";
    }
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
    const log = dayLog(dateStr) || { flow: 0, cramps: 0, symptoms: [], moods: [], note: "" };
    sheetDraft = {
      flow: log.flow || 0,
      cramps: log.cramps || 0,
      symptoms: (log.symptoms || []).slice(),
      moods: (log.moods || []).slice()
    };
    $("sheetTitle").textContent = D.cn(dateStr) + " 周" + D.weekday(dateStr);
    $("sheetNote").value = log.note || "";
    renderSheetPeriod();
    renderSheetChips();
    $("sheetMask").hidden = false;
  }

  /* 弹层最上面那块：这天到底算不算经期，以及一键改开始/结束 */
  function renderSheetPeriod() {
    const d = sheetDate;
    const m = model();
    const cur = periodAt(d);
    const stateEl = $("sheetPeriodState");
    const box = $("sheetPeriodBtns");
    box.innerHTML = "";
    const again = (msg) => { invalidate(); renderSheetPeriod(); renderAll(); toast(msg); };

    /* 未来的日子不给记经期：还没发生的事，谈不上「已经来了」。*/
    if (D.diff(m.today, d) > 0) {
      stateEl.textContent = "这天还没到";
      return;
    }

    if (cur) {
      const ongoing = !cur.end;
      const shown = ongoing ? D.add(cur.start, Math.max(0, m.periodLength - 1)) : cur.end;
      const len = D.diff(cur.start, shown) + 1;
      stateEl.textContent = "在经期里 · 第 " + (D.diff(cur.start, d) + 1) + " 天（" +
        D.cn(cur.start) + " 起" + (ongoing ? "，还没结束" : " 到 " + D.cn(cur.end) + "，共 " + len + " 天") + "）";

      if (d > cur.start && d !== cur.end) {
        box.appendChild(chip("这天是最后一天", false, () => {
          if (markPeriodEnd(d)) again("好，这次经期到 " + D.cn(d));
        }));
      }
      /* 要是当初把一次经期记成了两段（26 号一段、31 号又一段这种），
         在这里一键接回去，不用绕好几步。*/
      const prev = periods().filter((p) => p.start < cur.start).pop();
      if (prev && D.diff(prev.start, cur.start) <= 12) {
        box.appendChild(chip("并到上一次里", false, () => {
          const list = periods().filter((p) => p !== cur);
          const target = list.filter((p) => p.start < cur.start).pop();
          if (target) target.end = cur.end || d;
          state.periods = normalizePeriods(list);
          save(true); invalidate();
          again("接回去了，" + D.cn(target.start) + " 到 " + D.cn(target.end));
        }));
      }
      box.appendChild(chip("这天不算经期", false, () => {
        if (clearPeriodDay(d)) again("改好了");
      }));
    } else {
      stateEl.textContent = "这天不在经期里";
      box.appendChild(chip("这天来经期了", false, () => {
        if (markPeriodStart(d)) again(D.cn(d) + " 记为经期第一天");
      }));
      const before = periods().filter((p) => p.start < d).pop();
      /* 只要这天之前有过经期，就允许「我的经期在这天结束」——
         这样她要是当初把一次经期记成了两段，点一下就能接回去。*/
      if (before) {
        box.appendChild(chip("这天经期结束", false, () => {
          if (markPeriodEnd(d)) again("好，这次经期到 " + D.cn(d));
        }));
      }
    }
  }

  function renderSheetChips() {
    const f = $("sheetFlow");
    f.innerHTML = "";
    FLOWS.forEach((x) => f.appendChild(chip(x.label, sheetDraft.flow === x.v, () => {
      sheetDraft.flow = x.v;
      renderSheetChips();
    })));

    const c = $("sheetCramps");
    c.innerHTML = "";
    CRAMPS.forEach((x) => c.appendChild(chip(x.label, sheetDraft.cramps === x.v, () => {
      sheetDraft.cramps = x.v;
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
      cramps: sheetDraft.cramps,
      symptoms: sheetDraft.symptoms.slice(),
      moods: sheetDraft.moods.slice(),
      note: $("sheetNote").value.trim()
    };
    editDay(dateStr, (d) => {
      d.flow = draft.flow;
      d.cramps = draft.cramps;
      d.symptoms = draft.symptoms;
      d.moods = draft.moods;
      d.note = draft.note;
    });
    const inPeriod = dayInPeriod(dateStr);
    invalidate();
    closeSheet();
    renderAll();
    toast("已保存 " + D.cn(dateStr));
    if (inPeriod) burst();
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
        state = upgrade(data);   // 老版本的备份也能直接导进来
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

    /* 首页快捷记录：一个周期只需要点两下，中间自动算 */
    $("btnPeriodStart").addEventListener("click", () => {
      if (!markPeriodStart(D.today())) return;
      invalidate(); renderAll();
      toast("记下了，今天是经期第 1 天");
      burst();
    });

    $("btnPeriodEnd").addEventListener("click", () => {
      const m = model();
      /* 今天可能在两段里：一段还没点结束，或者一段已经写了结束日但那天还没到。
         两种都该能在这里收尾，不能因为没「进行中」就点了没反应。*/
      if (!m.inPeriod || !m.currentPeriod) return;
      if (m.dayOfPeriod > m.periodLength + 4 &&
          !confirm("这次经期已经记了 " + m.dayOfPeriod + " 天，结束日就是今天吗？\n\n" +
                   "（如果其实早就结束了，点取消，然后去日历上点一下真正的最后一天）")) return;
      if (!markPeriodEnd(D.today())) return;
      invalidate(); renderAll();
      toast("好，这次经期到 " + D.cn(D.today()));
    });

    $("btnBannerEnd").addEventListener("click", () => $("btnPeriodEnd").click());
    $("btnBannerSnooze").addEventListener("click", () => {
      state.settings.snoozeUntil = D.today();
      save(true);
      renderBanner();
      toast("好，那先不管它");
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
    periods: periods,
    normalizePeriods: normalizePeriods,
    periodAt: periodAt,
    dayInPeriod: dayInPeriod,
    markPeriodStart: markPeriodStart,
    markPeriodEnd: markPeriodEnd,
    clearPeriodDay: clearPeriodDay,
    symptomPatterns: symptomPatterns,
    tipFor: tipFor,
    TIP_BANK: TIP_BANK,
    openSheet: openSheet,
    saveSheet: saveSheet,
    closeSheet: closeSheet,
    renderAll: renderAll,
    getState: function () { return state; },
    setState: function (s) { state = s; invalidate(); }
  };
})();
