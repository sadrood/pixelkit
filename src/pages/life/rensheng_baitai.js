// ============================================================
// 成长模拟器 · 剧本②：人生百态
// 纯数据（与剧本①同构，可整体替换以扩展新剧本）。引擎见 ../LifeSimPage.js
// 约定：
//  - 属性 key：psy 心态 / body 体格 / opp 机遇 / int 学识 / soc 人际
//  - 衍生：money(元) / health(0-100) / happy(0-100)
//  - 事件 effect 增量为数值；money 单位≈“元”；可增删 status；flag 用于一次性剧情
//  - income 按最高职级/人生状态发放年薪
// ============================================================
export const RSBT = {
  id: 'renshengbaitai',
  title: '人生百态',
  tagline: '1990 年，你在北方一座小县城出生。这一生会走向哪条路——是安稳，是冒险，是锦衣玉食，还是举步维艰？没有人能告诉你。',
  startYear: 1990,

  attrMeta: {
    psy: { label: '心态' }, body: { label: '体格' }, opp: { label: '机遇' },
    int: { label: '学识' }, soc: { label: '人际' },
  },

  // 状态字典（事件 addStatus / 结局 / UI chips / 收入职级共用）
  statuses: [
    { key: 'student', label: '求学路上' },
    { key: 'diploma', label: '高学历', desc: '读过不少书，底气足一点' },
    { key: 'worker', label: '打工人', desc: '朝九晚五，普普通通' },
    { key: 'whitecollar', label: '职场白领', desc: '格子间里的体面与忙碌' },
    { key: 'boss', label: '自己当老板', desc: '盈亏自负，风浪自己扛' },
    { key: 'urban', label: '大城定居', desc: '背上行囊，离开小城' },
    { key: 'marriage', label: '已婚' },
    { key: 'kid', label: '为人父母' },
    { key: 'houseloan', label: '房奴', desc: '月供如山压身' },
    { key: 'sick', label: '慢性病', desc: '体检单不再好看', danger: true },
    { key: 'lowpsy', label: '抑郁倾向', desc: '心里阴雨连绵', danger: true },
    { key: 'pension', label: '退休在家' },
    { key: 'blessed', label: '儿孙绕膝' },
  ],

  // 年薪档位（元/年）：按最高人生状态发钱；匹配顺序即优先级
  income: [
    { if: 'pension', per: 80000 },
    { if: 'boss', per: 300000 },
    { if: 'whitecollar', per: 130000 },
    { if: 'worker', per: 65000 },
  ],

  backgrounds: [
    { id: 'poor', label: '贫寒家庭', desc: '父母打工拉扯你长大，学费是一分一分凑的。', money: 3000, init: { psy: 48, body: 60, opp: 25, int: 52, soc: 46 } },
    { id: 'ordinary', label: '普通工薪家庭', desc: '爸妈捧个铁饭碗，日子不宽裕也不紧巴。', money: 20000, init: { psy: 52, body: 55, opp: 42, int: 55, soc: 50 } },
    { id: 'scholar', label: '知识分子家庭', desc: '家里书比零食多，爸妈总说：万般皆下品，惟有读书高。', money: 45000, init: { psy: 50, body: 48, opp: 45, int: 68, soc: 46 } },
    { id: 'rich', label: '优渥家庭', desc: '家里有厂有铺，你从小不缺零花钱，也早早见识过世面。', money: 200000, init: { psy: 50, body: 58, opp: 60, int: 55, soc: 58 } },
  ],

  // 人生金手指：pick 1 或 none
  cheats: [
    { id: 'none', label: '白纸一张', desc: '不借任何外力，看看自己能走成什么样。', effect: {} },
    { id: 'ironbody', label: '铁打的体格（体格 +12）', desc: '从小不怎么生病，扛得住熬。', effect: { body: 12 } },
    { id: 'goodmemory', label: '过目不忘（学识 +12）', desc: '考试、学东西，都比别人快。', effect: { int: 12 } },
    { id: 'lucky', label: '锦鲤附体（机遇 +12）', desc: '关键时刻，总有一条岔路为你留门。', effect: { opp: 12 } },
    { id: 'evenkeel', label: '情绪稳定内核（心态 +12）', desc: '天塌下来，你也睡得着。', effect: { psy: 12 } },
  ],

  // 阶段：rounds=本阶段必选大事件轮数；actionSlots=本阶段主动行动次数
  stages: [
    { id: 'childhood', label: '童年 · 小镇', year: [1990, 1998], rounds: 3, actionSlots: 1 },
    { id: 'youth', label: '少年 · 求学', year: [1998, 2008], rounds: 4, actionSlots: 1 },
    { id: 'start', label: '青年 · 入世', year: [2008, 2015], rounds: 4, actionSlots: 2 },
    { id: 'mid', label: '中年 · 立业', year: [2015, 2028], rounds: 4, actionSlots: 2 },
    { id: 'load', label: '中年 · 承重', year: [2028, 2045], rounds: 4, actionSlots: 2 },
    { id: 'old', label: '暮年 · 回望', year: [2045, 2065], rounds: 3, actionSlots: 1 },
  ],

  // 阶段收尾文案（引擎回退到内置 map，剧本自定义优先）
  stageIntros: {
    childhood: ['童年像一场漫长的夏天：蝉鸣、作业、爸妈下班时的自行车铃声。', '你背着书包走出了小镇，身后是爸妈挥了半天的手。'],
    youth: ['少年人的世界里，天总是很大，路总是很长。', '你亲手写下人生第一道分水岭：那张薄薄的高考志愿表。'],
    start: ['象牙塔的屋顶在你身后合拢，你站到了真实世界的门口。', '头几年，你在城市和老家之间来回打量，像一只刚刚会飞的鸟。'],
    mid: ['三十而立。房贷、孩子、父母的药费，桩桩件件都落到了你肩上。', '中年像一部上足发条的钟，走着走着，你忽然想看看自己走到了哪。'],
    load: ['上有白发，下有青春，你是夹在中间那个不敢倒的人。', '岁月不饶人，可你也从未饶过岁月。'],
    old: ['日子慢了下来，你终于有时间把一辈子从头翻一遍。', '人生的这场账，该坐下来慢慢盘一盘了。'],
  },

  // 阶段大事件（每阶段抽 round 个，once 不重复；first 该阶段第一轮必出）
  big: [
    // —— 童年 · 小镇 ——
    { id: 'c1', stage: 'childhood', first: true, text: '那几年镇上生意难做，你爸下了岗又再就业，你妈在医院上夜班。后半夜，大人们总压着声音说钱的事。',
      choices: [
        { text: '乖巧懂事，不吵不闹', effect: { psy: 3, int: 2, happy: 1 }, log: '你过早学会了“不给大人添麻烦”。' },
        { text: '该玩玩该闹闹，孩子气十足', effect: { body: 4, happy: 3 }, log: '当个无忧无虑的小孩，也是一种天赋。' },
      ] },
    { id: 'c2', stage: 'childhood', text: '邻居小孩每天有一块钱零花，你没有。他举着一根冰棍在你面前晃来晃去。',
      choices: [
        { text: '眼馋，但忍住了，回家翻小人书', effect: { int: 5, psy: 1 }, log: '买不起冰棍的日子，你爱上了看书。' },
        { text: '趁爸妈不在，偷了抽屉里的几毛钱', effect: { opp: 1, psy: -3 }, log: '冰棍很甜，可那个下午你一直不敢看妈的眼睛。' },
      ] },
    { id: 'c3', stage: 'childhood', text: '小学报到第一天，老师问大家长大后想干什么。',
      choices: [
        { text: '科学家！', effect: { int: 6 }, log: '老师夸你有志气，你悄悄把这个答案记了很多年。' },
        { text: '挣大钱', effect: { soc: 2, opp: 1 }, log: '老师愣了一下，全班都笑了。' },
        { text: '实话实说：不知道', effect: { psy: 3 }, log: '现在就想多玩会儿，哪想得了那么远。' },
      ] },
    { id: 'c4', stage: 'childhood', text: '那年你发了一场高烧，烧到 40 度，在医院住了整整一周。',
      choices: [
        { text: '病好后开始早起锻炼，想强壮一点', effect: { body: 8, psy: 2 }, log: '操场跑圈的时候，你觉得自己什么病都打不倒。' },
        { text: '落下怕冷的毛病，能躲就躲', effect: { body: -4, psy: -1 }, log: '体弱的孩子，童年里多一层小心翼翼的底色。' },
      ] },
    { id: 'c5', stage: 'childhood', text: '临近开学，你听到爸妈在里屋为学费吵架。一个说要供，一个说家里真的揭不开锅。',
      choices: [
        { text: '认真读书，让他们看见点希望', effect: { int: 5, psy: 3 }, log: '你第一次觉得，成绩单能当大人的定心丸。' },
        { text: '假装听不见，钻进被窝', effect: { psy: -2, happy: 1 }, log: '有些声音，你很多年后才敢去听。' },
      ] },
    { id: 'c6', stage: 'childhood', text: '镇上的老槐树下，你和发小们约好：以后谁混好了，要带大家一起吃香的喝辣的。',
      choices: [
        { text: '认真点头，记在心里', effect: { soc: 4, opp: 1 }, log: '童言无忌，可有些情谊是真秤砣。' },
        { text: '嘻嘻哈哈，转头就忘', effect: { happy: 3 }, log: '小孩子哪懂什么叫“混好了”。' },
      ] },

    // —— 少年 · 求学 ——
    { id: 'y1', stage: 'youth', first: true, text: '中考填志愿的晚上，班主任把成绩单摊在你面前：“考个好高中，是普通家庭孩子改变命运的路。”',
      choices: [
        { text: '拼一把省重点', effect: { int: 6, health: -3, opp: 3 }, log: '你考上了，全班掌声里你的名字被念得格外用力。' },
        { text: '读职高，早点学门手艺', effect: { body: 3, opp: 1, soc: 2 }, log: '读书的路不止一条，你早早在技能上找到了存在感。' },
      ] },
    { id: 'y2', stage: 'youth', text: '高二，同桌开始早恋，成绩一路下滑。有天你抽屉里，被人塞了一封信。',
      choices: [
        { text: '婉拒，先考完再说', effect: { int: 4, soc: -2 }, log: '有些话，等有资格说的时候再说。' },
        { text: '偷偷交往，甜蜜又分心', effect: { happy: 5, int: -3, soc: 3 }, log: '少年人的喜欢，热烈也莽撞。' },
      ] },
    { id: 'y3', stage: 'youth', text: '高考前一晚，你辗转反侧，数了第三千只羊也没睡着。',
      choices: [
        { text: '深呼吸，把错题本从头过一遍', effect: { psy: 4, int: 2 }, log: '脑子里过完知识点，心里反而定了。' },
        { text: '破罐破摔，闭眼硬睡', effect: { happy: 1, psy: -2 }, log: '该来的总会来，你学会了用“顺其自然”安慰自己。' },
        { text: '偷偷摸出半片安眠药', effect: { body: -2, psy: -1 }, log: '药是睡了，第二天头却沉得像罐了铅。' },
      ] },
    { id: 'y4', stage: 'youth', text: '出分那天下午，阳光很烈。你攥着手机，反复输入查分网站地址，手心全是汗。',
      choices: [
        { text: '金榜题名，上了全日制本科', need: s => s.int >= 55, effect: { int: 3, opp: 3, happy: 4 }, addStatus: ['student', 'diploma'], log: '爸妈摆了一桌，请了全楼的邻居。' },
        { text: '上了专科/技校，先学门手艺', effect: { body: 2, soc: 3 }, addStatus: ['student'], log: '那张录取通知书没那么亮，你却第一次觉得自己长大了。' },
      ] },
    { id: 'y5', stage: 'youth', text: '大学校园比你想象的更大。图书馆、社团、兼职中介的传单，一起朝你涌来。',
      choices: [
        { text: '泡图书馆刷绩点', effect: { int: 6, opp: 2 }, log: '别人谈恋爱时，你在自习室坐了三年冷板凳。' },
        { text: '混社团，攒一帮朋友', effect: { soc: 6, opp: 2 }, log: '你认识了形形色色的人，也练出了张嘴就来的胆。' },
        { text: '打工赚学费，减轻家里负担', effect: { money: 40000, body: -3, int: -2 }, log: '发传单、端盘子、当家教，你用辛苦换开销。' },
      ] },
    { id: 'y6', stage: 'youth', text: '毕业季，宿舍楼下贴满招工启事和考研广告。舍友有的考公，有的回老家，有的奔北上广。',
      choices: [
        { text: '投简历，去大城市闯一闯', need: s => s.soc >= 40 || s.int >= 50, effect: { opp: 5, soc: 2, happy: 2 }, addStatus: ['urban'], log: '你拖着行李箱挤上南下的火车，心里一半忐忑一半野心。' },
        { text: '继续读研深造', need: s => s.int >= 50, effect: { int: 6, opp: 2 }, addStatus: ['student'], log: '你决定再打磨几年，再谈入世。' },
        { text: '回老家小城，图个安稳', effect: { happy: 4, opp: -1 }, log: '小城的黄昏来得早，日子也过得慢，你暂时不后悔。' },
      ] },
    { id: 'y7', stage: 'youth', text: '有朋友劝你家里凑钱买一套当时的小城房产，说你以后会知道值不值。',
      choices: [
        { text: '咬咬牙，劝爸妈买下', effect: { money: -120000, opp: 6, psy: -2 }, log: '多年后你会知道，这间房子成了你人生的一个支点。' },
        { text: '钱留着读书用，先不买', effect: { int: 3, opp: -2 }, log: '当时的决定，很久以后才被时间证明对错。' },
      ] },

    // —— 青年 · 入世 ——
    { id: 's1', stage: 'start', first: true, text: '初入社会，你的第一份营生摆在面前：格子间的工牌、工地的安全帽，或是夜市的一辆小推车。',
      choices: [
        { text: '进公司，从白领做起', effect: { money: 30000, int: 2 }, addStatus: ['whitecollar'], log: '你有了第一张工牌，也有了第一笔加班费。' },
        { text: '进厂/跑腿，先当个踏实的打工人', effect: { money: 15000, body: 2 }, addStatus: ['worker'], log: '钞票挣得辛苦，用得也踏实。' },
        { text: '租摊摆摊，自己当老板', effect: { money: -60000, opp: 4 }, addStatus: ['boss'], log: '你赌了一把，把攒的钱都压进了临街的一角。' },
      ] },
    { id: 's2', stage: 'start', text: '出租屋月租又涨了 200，快抵上你工资的一半。房东在门口用粉笔写了新数字。',
      choices: [
        { text: '换个更远的地下室，图省钱', effect: { money: 2000, body: -3, happy: -3 }, log: '省下的钱存进卡里，也把青春存进了潮湿的地下室。' },
        { text: '咬牙租下近的，把时间花在刀刃上', effect: { psy: -2, int: 2, happy: 1 }, log: '你多省出了一个多小时，都用来学东西了。' },
      ] },
    { id: 's3', stage: 'start', text: '公司传出裁员消息，名单上隐约有你。茶水间里，大家都在假装没听说。',
      choices: [
        { text: '主动多接活，刷存在感', effect: { body: -4, int: 3, soc: 2 }, log: '你硬是把自己熬成了那个“不好裁”的人。' },
        { text: '悄悄投简历，骑驴找马', effect: { opp: 3, psy: 1 }, log: '鸡蛋不放在一个篮子里，是你的社会第一课。' },
        { text: '留下赌一把，赌公司不舍得动', effect: { psy: -3, opp: 1, money: 10000 }, log: '你赌赢了这一把，奖金到账，惊险刺激。' },
      ] },
    { id: 's4', stage: 'start', text: '一个老同学拉你合伙创业，开口要借 5 万，说半年翻本。这抵你大半年的工资。',
      choices: [
        { text: '搭进去，搏一把', need: s => s.opp >= 40 || s.soc >= 45, effect: { money: -50000, opp: 6, psy: 2 }, log: '生意起起伏伏，你赔过也赚过，总算在市场上立住了脚。' },
        { text: '婉拒，钱留着应急', effect: { psy: 3, happy: 1 }, log: '钱没借出去，情谊也还在，你睡得踏实。' },
      ] },
    { id: 's5', stage: 'start', text: '恋爱谈了两三年，双方父母都催着定下来。谈婚论嫁，绕不开那两个字：买房。',
      choices: [
        { text: '凑首付买房，背上一身月供', effect: { money: -200000, happy: 6 }, addStatus: ['marriage', 'houseloan'], log: '领证那天，你在红本上签字，也在贷款合同上签了字。' },
        { text: '先立业后成家，再攒两年', effect: { soc: -2, psy: 2, money: 50000 }, log: '你把婚期往后推了推，也给生活留了口气。' },
      ] },
    { id: 's6', stage: 'start', text: '老同学聚会：有人县城买了房，有人北漂还在合租，有人已经开上了车。你端着一杯酒，心里翻腾。',
      choices: [
        { text: '听听就好，过自己的日子', effect: { psy: 4 }, log: '比较是最伤人的慢性病，你学会了不治。' },
        { text: '回去越想越不是滋味，失眠', effect: { psy: -5 }, log: '那晚你翻了很多次手机，看房价，看别人朋友圈。' },
        { text: '狠下心搞副业，闷声攒钱', effect: { money: 30000, body: -2, int: 2 }, log: '白天一份工，晚上一份工，你把自己活成了两台机器。' },
      ] },

    // —— 中年 · 立业 ——
    { id: 'm1', stage: 'mid', first: true, text: '三十多岁，事业上摆着一个不大不小的岔路口：外派、留守，或者干脆单干。',
      choices: [
        { text: '接外派，薪资翻倍但常年出差', effect: { money: 150000, body: -5, happy: -3 }, log: '你在异地租下又一个单人公寓，工资卡上的数字涨了，家却越来越远。' },
        { text: '留在本地，稳步上升', effect: { soc: 3, money: 50000, happy: 2 }, log: '你选择把烟火气握在手里。' },
        { text: '辞职创业，背水一战', need: s => s.opp >= 45 && s.psy >= 40, effect: { money: -150000, opp: 8, psy: -3 }, addStatus: ['boss'], log: '自己当老板之后，你才懂什么叫“睡不着的夜”。' },
      ] },
    { id: 'm2', stage: 'mid', text: '孩子到了上小学的年纪，学区房三个字像一座大山，压到你家饭桌上。',
      choices: [
        { text: '咬牙换学区房，全家紧巴点', effect: { money: -300000, happy: -4 }, addStatus: ['houseloan'], log: '房子换了，你也把自己换进了更长的账期。' },
        { text: '就近入学，家长多上心辅导', effect: { psy: 2, int: 3 }, log: '你陪孩子写了三年作业，成绩照样名列前茅。' },
      ] },
    { id: 'm3', stage: 'mid', text: '体检报告摊在桌上：脂肪肝、三高、颈椎反弓。医生抬眼看了看你：“再不注意，就晚了。”',
      choices: [
        { text: '戒熬夜，办张健身卡', effect: { body: 8, health: 10, money: -10000 }, log: '跑步机上，你把前半生欠身体的债一点一点还。' },
        { text: '工作放不下，先吃药顶着', effect: { body: -4, health: -4 }, addStatus: ['sick'], log: '药瓶上了桌，你就再没拿下来过。' },
      ] },
    { id: 'm4', stage: 'mid', text: '单位空降一个新领导，处处给你穿小鞋。大会小会，你的名字总被拎出来“提醒”。',
      choices: [
        { text: '忍，做好本分，等机会', effect: { psy: 2, body: -2 }, log: '你把委屈咽下去，咽得很熟练。' },
        { text: '跳槽换个环境', need: s => s.int >= 55 || s.soc >= 55, effect: { opp: 4, soc: 2, money: 40000 }, log: '你递了辞呈，在新公司重新找回了呼吸。' },
        { text: '硬刚，据理力争', effect: { psy: -3, soc: -2 }, log: '你赢了这一回，也赢来了接下来三年的“不好相处”。' },
      ] },
    { id: 'm5', stage: 'mid', text: '父母身体开始出问题，老家那边一趟趟打电话。你在这头和那头之间来回奔波。',
      choices: [
        { text: '接父母同住，挤一挤也认了', effect: { money: -60000, happy: 3, body: -3 }, log: '一家人挤在小屋里，饭桌反而比从前更圆。' },
        { text: '每月打钱、请护工，逢年过节回去', effect: { money: -80000, psy: -1 }, log: '钱代替你守在他们身边，可你也清楚有些东西不是钱能代替的。' },
      ] },
    { id: 'm6', stage: 'mid', text: '孩子出生那晚，产房外的走廊灯很亮。你抱着襁褓，忽然觉得肩上的世界重了很多。',
      choices: [
        { text: '紧紧握住这只小手，暗自起誓', effect: { psy: 3, happy: 4 }, addStatus: ['kid'], log: '从此你的计划里，多了一个小人的一生。' },
        { text: '紧张到手抖，只觉得责任如山', effect: { psy: -2, body: -1 }, addStatus: ['kid'], log: '初为人父/母，慌乱和幸福一起涌上心头。' },
      ] },
    { id: 'm7', stage: 'mid', text: '一位相熟的贵人给你递来一个稳定但平淡的机会：清闲、够用，就是没什么上升空间。',
      choices: [
        { text: '接住它，稳稳当当过下去', effect: { opp: 2, happy: 3, body: 2 }, log: '你开始体会到，“稳”本身也是一种幸福。' },
        { text: '婉拒，还想再冲一冲', effect: { opp: 1, psy: 1 }, log: '你不甘心停在半山腰，宁可再登一段。' },
      ] },

    // —— 中年 · 承重 ——
    { id: 'l1', stage: 'load', first: true, text: '四十多岁，上有双亲、下有儿女，钱像流水一样往外走。月底一算，积蓄所剩无几。',
      choices: [
        { text: '开源自救：接私活、搞副业', effect: { money: 80000, body: -3, psy: 1 }, log: '你在深夜的电脑前，又捡起了年少的干劲。' },
        { text: '节流：全家省着点过', effect: { happy: -2, money: 30000 }, log: '日子朴素了，账本上的数字稳住了。' },
        { text: '心态放平，过一天算一天', effect: { psy: 3, money: -10000 }, log: '有些账，愁也愁不完，不如先睡个整觉。' },
      ] },
    { id: 'l2', stage: 'load', text: '行业变天，AI 和年轻人一起来了，你说不清哪样更让你心慌。多年的经验，一夜之间不那么值钱了。',
      choices: [
        { text: '转型学新东西，中年从头再来', effect: { int: 8, money: -30000, psy: 1 }, log: '你在培训班里跟二十岁的人同堂，也把面子放下了。' },
        { text: '死守老本行，赌它不会塌', effect: { psy: -4, opp: -2, happy: -2 }, log: '你越守，越觉得脚下那块地在松动。' },
        { text: '提早盘算，做个稳妥的退休规划', effect: { psy: 2, opp: 1, money: 20000 }, log: '你给自己留好了退路，心反而定了一些。' },
      ] },
    { id: 'l3', stage: 'load', text: '孩子进入青春期，跟你大吵一架，甩上门说：“你根本不懂我！”门板震得嗡嗡响。',
      choices: [
        { text: '放下架子，敲门好好听 ta 说话', effect: { soc: 4, psy: 2, happy: 2 }, log: '那晚你们聊到很晚，中间隔的那堵墙，塌了一角。' },
        { text: '摆出家长威严，先压下去再说', effect: { soc: -2, psy: -3 }, log: '门是安静了，可你知道有些缝没合上。' },
      ] },
    { id: 'l4', stage: 'load', text: '老同学突发心梗走了，葬礼上满屋子的中年人都沉默。你忽然想：人这一辈子，到底图什么。',
      choices: [
        { text: '拾起年轻时丢下的爱好', effect: { happy: 8, psy: 3 }, log: '你又拿起了那支落了灰的笔，画第一张画时手都抖。' },
        { text: '更拼命挣钱，怕人到老没底气', effect: { money: 40000, body: -4 }, log: '你把对死亡的恐惧，全化成了抢工期的狠劲。' },
        { text: '照常过，不去想这些', effect: { psy: -2 }, log: '日子照过，可某些夜晚你得靠数羊才能睡着。' },
      ] },
    { id: 'l5', stage: 'load', text: '公司裁员的名单终于还是落在你头上，或者生意在某个夜里突然冷了下去。你一下子闲了。',
      choices: [
        { text: '四处找机会，不敢停下来', effect: { opp: 3, body: -3, psy: -1 }, log: '你像一头不敢停的陀螺，怕停下就起不来。' },
        { text: '当放一个长假，陪陪家人', effect: { happy: 4, psy: 2, money: -20000 }, log: '你陪父母做了顿家常饭，忽然觉得“失业”也没那么可怕。' },
      ] },
    { id: 'l6', stage: 'load', text: '网上满屏都在谈“中年危机”。镜子里的你，鬓角有了白发，腰围也圆了些。',
      choices: [
        { text: '报班学点新东西，给大脑充充电', effect: { int: 5, money: -20000, happy: 1 }, log: '新技能的快乐帮你把年龄焦虑顶走了一截。' },
        { text: '开始健身，把身体管起来', effect: { body: 7, happy: 2, health: 5 }, log: '练了大半年，你比三十岁时还精神。' },
        { text: '笑了笑，把手机放下', effect: { psy: 3 }, log: '你跟自己和解：危机年年有，人得往前活。' },
      ] },
    { id: 'l7', stage: 'load', text: '连续几年高压力，某天早晨你坐在床边，觉得心里堵得喘不过气，对什么都提不起劲。',
      choices: [
        { text: '正视它，去看心理医生', effect: { psy: 8, happy: 4, money: -12000 }, log: '那句“你不必一个人扛”让你在诊室里红了眼眶。' },
        { text: '熬一熬，也许过阵子就好了', effect: { psy: -8, happy: -5 }, addStatus: ['lowpsy'], log: '你把它埋进最深处，可它会在深夜自己长出来。' },
      ] },
    { id: 'l8', stage: 'load', text: '老家拆迁，补偿款下来了，够付乡下一套房，也够你给自己换个活法。',
      choices: [
        { text: '拿钱给小家换套大点的房', effect: { money: 100000, happy: 4, opp: 1 }, log: '住了这么多年，你们终于搬进了亮堂堂的大房子。' },
        { text: '一半给父母养老，一半留作底气', effect: { money: 150000, psy: 3, soc: 2 }, log: '你觉得自己第一次把钱花得这么明白。' },
      ] },

    // —— 暮年 · 回望 ——
    { id: 'o1', stage: 'old', first: true, text: '退休通知下来的那天下午，你一个人坐在阳台上，泡了壶茶，把这一生从头想了一遍。',
      choices: [
        { text: '平静接受，含饴弄孙', effect: { happy: 6, psy: 3 }, addStatus: ['pension'], log: '茶凉了又续，你承认自己“终于可以不属于任何人了”。' },
        { text: '闲不住，返聘发挥余热', effect: { money: 30000, opp: 1, body: -2 }, addStatus: ['pension'], log: '你又回到人群里，被人需要着，比闲着踏实。' },
        { text: '背起行囊，去看年轻时没看的风景', effect: { happy: 10, money: -50000, body: -2 }, addStatus: ['pension'], log: '你把那些写进过愿望清单的地方，一站一站走完。' },
      ] },
    { id: 'o2', stage: 'old', text: '孙辈抱着你的腿，仰着脸问：“爷爷/奶奶，你年轻时最骄傲的事是什么？”',
      choices: [
        { text: '讲年轻时翻山越岭的闯荡', effect: { happy: 5, soc: 2 }, log: '讲到兴处你眼睛亮了，仿佛又回到当年。' },
        { text: '沉默片刻：平凡过日子就挺好', effect: { psy: 5 }, log: '你生平头回觉得，无惊无险四个字也是勋章。' },
        { text: '翻开老照片，一页页讲给他们听', effect: { happy: 7 }, addStatus: ['blessed'], log: '照片泛黄，故事不旧，你成了家里的“说书人”。' },
      ] },
    { id: 'o3', stage: 'old', text: '老友约你下棋。棋盘对面空了一个位置——另一位老伙计，已经走不动了。',
      choices: [
        { text: '多串串门，聚一次少一次', effect: { happy: 6, soc: 4, body: 1 }, log: '你们谈的更多是忆当年，谁也没再提输赢。' },
        { text: '催孩子们常回家看看', effect: { happy: 3, psy: 2 }, addStatus: ['blessed'], log: '你学会了用“有空回来吃饭”表达所有的想念。' },
      ] },
    { id: 'o4', stage: 'old', text: '整理旧物时，你翻出一只落满灰的木匣子：成绩单、第一份工牌、孩子的满月照，还有一张褪色的火车票。',
      choices: [
        { text: '一一看过去，像读完自己的一生', effect: { psy: 6, happy: 4 }, log: '你这一生有高光有低谷，可每一程你都认真活过。' },
        { text: '挑几样裱起来，挂在客厅', effect: { happy: 5, soc: 2 }, log: '它们成了你递给未来的晚辈的一张自我介绍。' },
      ] },
    { id: 'o5', stage: 'old', text: '体检中心的医生说：“老太太/老爷子，您这身体底子，比同龄人强多了。”',
      choices: [
        { text: '抿嘴一笑：年轻时候攒下的', effect: { happy: 4, body: 2 }, log: '你想起操场上的晨跑、夜以继日的自律，值了。' },
        { text: '摸摸后腰：哎，零件都旧啦', effect: { psy: -1, happy: -2 }, log: '身体是诚实的账本，好在你还翻得动。' },
      ] },
  ],

  // 随机小事件（轻量，进阶段轮之间概率触发）
  small: [
    { id: 'sm1', text: '楼下早餐铺的老板娘记住了你的口味，每次都多给你加个蛋。', effect: { happy: 3 } },
    { id: 'sm2', text: '你在地铁上给一位老人让了座，下车时他朝你点了点头。', effect: { soc: 2, psy: 1 } },
    { id: 'sm3', text: '周末大扫除，你从旧书堆里翻出夹着的一张奖状，看了很久。', effect: { happy: 2, int: 1 } },
    { id: 'sm4', text: '单位/店里组织团建，你被拉着表演了个节目，掌声稀稀拉拉，你笑得很开。', effect: { soc: 3, happy: 2 } },
    { id: 'sm5', text: '深夜加班回家，路过夜市，你给自己买了根烤肠，站在路灯下慢慢吃完。', effect: { happy: 2, money: -500 } },
    { id: 'sm6', text: '老家的亲戚进城，塞给你一兜自家种的菜。你嘴上说着“太客气”，心里暖了一整天。', effect: { psy: 3, money: -500 } },
    { id: 'sm7', text: '超市促销，你抢到了最后一提打折鸡蛋，像占了天大的便宜，得意了一下午。', effect: { happy: 2, money: 300 } },
    { id: 'sm8', text: '某天早上你起得格外早，在阳台看了一场完整的日出，忽然觉得什么都还有可能。', effect: { psy: 4 } },
    { id: 'sm9', text: '手机里弹出老同学的消息：“在吗？最近怎么样？”你回了句“还行”，然后各自沉默。', effect: { soc: 1, psy: -1 } },
    { id: 'sm10', text: '你坚持每天走一万步。一个月后，体重秤上的数字小了两斤。', effect: { body: 3, health: 4 } },
    { id: 'sm11', text: '孩子/晚辈考了满分，举着卷子冲回家，你比自己当年拿奖学金还高兴。', effect: { happy: 5 } },
    { id: 'sm12', text: '雨夜，你忘带伞，在便利店门口等雨停，遇见一个同样忘带伞的陌生人，相视一笑。', effect: { psy: 2, opp: 1 } },
  ],

  // 主动行动
  actions: [
    { key: 'read', label: '📖 读书充电', stages: ['childhood', 'youth', 'start', 'mid', 'load'], desc: '书里自有黄金屋', effect: { int: 5, opp: 1, happy: -1 }, cost: 3000 },
    { key: 'play', label: '🎈 玩耍撒欢', stages: ['childhood', 'youth', 'start'], desc: '该玩玩，劳逸结合', effect: { happy: 5, body: 2 }, cost: 0 },
    { key: 'fitness', label: '🏃 锻炼身体', stages: ['childhood', 'youth', 'start', 'mid', 'load'], desc: '身体是革命的本钱', effect: { body: 5, health: 4 }, cost: 2000 },
    { key: 'social', label: '🍵 经营人脉', stages: ['start', 'mid', 'load'], desc: '多条朋友多条路', effect: { soc: 5, opp: 3, money: -10000 }, cost: 10000 },
    { key: 'hustle', label: '💼 加班搞钱', stages: ['start', 'mid', 'load'], desc: '用时间换钱', effect: { money: 60000, body: -3, happy: -2 }, cost: 0 },
    { key: 'learn', label: '📚 学门新技能', stages: ['youth', 'start', 'mid', 'load'], desc: '技多不压身', effect: { int: 6, opp: 2, money: -15000 }, cost: 15000 },
    { key: 'rest', label: '🛌 躺平休整', desc: '磨刀不误砍柴工', effect: { happy: 7, health: 5, psy: 3 }, cost: 0 },
  ],

  // 结算结局（cond 命中第一个 true）
  endings: [
    { id: 's_bigwin', tier: 'S', label: '时代弄潮儿', cond: s => s.status.has('boss') && s.money >= 500000 && !s.status.has('sick') && !s.status.has('lowpsy'), story: '你从第一辆小推车，一路推到别人叫你一声“老板”。山高路远的生意场上，你赢过也赔过，最后还是站到了浪头上。旁人只看见风光，只有你记得那些睡不着的夜。' },
    { id: 'a_middle', tier: 'A', label: '中产的体面', cond: s => s.status.has('whitecollar') && s.money >= 300000 && !s.status.has('sick'), story: '有一份体面的工作，一个还过得去的家，一张渐渐见厚的存折。你没有惊天动地，却在时代的水涨船高中稳稳站住了脚跟。' },
    { id: 'a_happy', tier: 'A', label: '平凡的小确幸', cond: s => s.status.has('marriage') && s.status.has('blessed') && s.happy >= 65 && !s.status.has('lowpsy'), story: '饭桌上的热汤、孩子的笑声、老友的几句闲谈——这些细碎的暖光，拼成了你的一生。你没追过大浪，但你把日子过成了别人羡慕的踏实。' },
    { id: 'b_plain', tier: 'B', label: '认真活过的普通人', cond: s => !s.status.has('sick') && !s.status.has('lowpsy') && s.happy >= 45, story: '认真读书、认真上班、认真爱过也认真错过。你这一生没有大剧本，唯一从头到尾没有掉队的，是你那颗想把日子过好的心。' },
    { id: 'c_tough', tier: 'C', label: '扛过风浪的人', cond: s => s.status.has('lowpsy') && s.psy >= 30, story: '你被生活按进水里过几次，呛过水，也差点没上来。可最后还是爬回岸上，把自己晾干，重新出发。能扛到今天，你已经赢了很多人。' },
    { id: 'd_broke', tier: 'D', label: '中年崩塌', cond: s => (s.status.has('sick') && s.body < 30) || (s.status.has('lowpsy') && s.psy < 30), story: '有些债，攒着攒着就成了压垮人的最后一根稻草。当健康或情绪先倒了，你再强的道理都没了支点。这盘棋走到这里，你不得不停。倘若人生能重开，愿你记得先照顾自己。', dark: true },
    { id: 'c_basic', tier: 'C', label: '普通而完整的一生', cond: () => true, story: '没有登顶，也没有坠落。你像千万人一样，在这座小城或大城里，把日子一天一天过到了头。平凡，但完整。', },
  ],

  achievements: [
    { id: 'a1', label: '读过大学', cond: s => s.status.has('diploma') },
    { id: 'a2', label: '闯过大城市', cond: s => s.status.has('urban') },
    { id: 'a3', label: '自己当老板', cond: s => s.status.has('boss') },
    { id: 'a4', label: '坐稳白领', cond: s => s.status.has('whitecollar') },
    { id: 'a5', label: '成家立业', cond: s => s.status.has('marriage') && s.status.has('kid') },
    { id: 'a6', label: '还清房账的底气', cond: s => s.status.has('houseloan') && s.money >= 100000 },
    { id: 'a7', label: '让身体先富起来', cond: s => s.body >= 70 && s.health >= 70 },
    { id: 'a8', label: '走出阴霾', cond: s => s.status.has('lowpsy') && s.psy >= 40 },
    { id: 'a9', label: '老有所依', cond: s => s.status.has('blessed') },
    { id: 'a10', label: '家有余粮', cond: s => s.money >= 400000 },
  ],
};

export default RSBT;
