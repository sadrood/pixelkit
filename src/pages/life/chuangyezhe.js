// 成长模拟器 · 剧本②：白手起家（创业者）——纯数据，玩法同引擎，收入来自经营不领薪
// 属性：shang商业头脑 kou口才谈判 tili体能 xin抗压心性 jishu技术 renmai人脉
export const CY = {
  id: 'chuangye',
  title: '白手起家：从摆摊到身家千万',
  tagline: '2005 年，你揣着从家里凑的几千块，站在省城的出租屋里。这辈子，不端铁饭碗，自己当老板。',
  startYear: 2005,
  pickHint: '创业九死一生，你偏要做那活下来的一个',

  stageIntros: {
    gong: ['你南下打工，流水线把你磨得没脾气，也磨出了一点野心。', '本钱攒够了，你打算换个活法。'],
    baitan: ['摆摊是门生意，也是门学问：看人流、看天气、看脸色。', '摊子撑住了，你想把它做成店。'],
    shop: ['有了铺面，你才算真正当老板。可老板的苦，才刚开始。', '店做大了，该想公司的事了。'],
    gongsi: ['注册了公司、上了轨道，风口一个接一个。', '公司上了台阶，你也站在了高台边沿。'],
    zhongjian: ['越大的盘子，越经不起一次错。高处风大，你抓紧栏杆。', '起落都尝过了，该想想怎么收场。'],
    lao: ['半生浮沉，你要考虑的不是怎么赢，而是怎么传。', '这一辈子，该盘一盘了。'],
  },

  attrMeta: {
    shang: { label: '商业头脑' }, kou: { label: '口才谈判' }, tili: { label: '体能' },
    xin: { label: '抗压心性' }, jishu: { label: '技术' }, renmai: { label: '人脉' },
  },

  statuses: [
    { key: 'street', label: '摆摊/打工' },
    { key: 'shop', label: '开了小店' },
    { key: 'company', label: '注册公司' },
    { key: 'brand', label: '有了品牌' },
    { key: 'invest', label: '拿到融资' },
    { key: 'marriage', label: '已婚' },
    { key: 'kid', label: '为人父母' },
    { key: 'debt', label: '背负债务', danger: true },
    { key: 'risk', label: '经营风险', danger: true },
    { key: 'retired', label: '退休/交班' },
    { key: 'cun', label: '创业教父', desc: '被写进案例的人' },
  ],

  income: [],

  backgrounds: [
    { id: 'worker', label: '打工出身', desc: '家里穷，高中毕业就南下。见过凌晨四点的流水线。', money: 3000, init: { shang: 40, kou: 42, tili: 68, xin: 60, jishu: 35, renmai: 10 } },
    { id: 'tech', label: '技校/程序员', desc: '会点技术，也能吃苦。你说这是最大的本钱。', money: 8000, init: { shang: 45, kou: 40, tili: 50, xin: 52, jishu: 70, renmai: 15 } },
    { id: 'biz', label: '小商人家庭', desc: '爹摆了一辈子摊，你从小会算账、会看脸色。', money: 30000, init: { shang: 58, kou: 55, tili: 48, xin: 55, jishu: 30, renmai: 30 } },
  ],

  cheats: [
    { id: 'none', label: '不选外挂', desc: '一步一个脚印。', effect: {} },
    { id: 'liuxing', label: '踩中风口（商业头脑 +12）', desc: '你隐约记得哪些行业后来起飞了。', effect: { shang: 12 } },
    { id: 'chouma', label: '贵人相助（人脉 +12）', desc: '前世帮你的人，这一世还会出现。', effect: { renmai: 12 } },
    { id: 'tiexin', label: '铁打的心（抗压 +12）', desc: '亏过的人最不怕亏。', effect: { xin: 12 } },
  ],

  stages: [
    { id: 'gong', label: '打工攒本', year: [2005, 2008], rounds: 3, actionSlots: 1 },
    { id: 'baitan', label: '摆摊试水', year: [2008, 2011], rounds: 4, actionSlots: 2 },
    { id: 'shop', label: '开店起家', year: [2011, 2016], rounds: 4, actionSlots: 2 },
    { id: 'gongsi', label: '开公司扩张', year: [2016, 2021], rounds: 4, actionSlots: 2 },
    { id: 'zhongjian', label: '高台与风险', year: [2021, 2026], rounds: 3, actionSlots: 1 },
    { id: 'lao', label: '守成与交班', year: [2026, 2035], rounds: 2, actionSlots: 1 },
  ],

  big: [
    { id: 'c1', stage: 'gong', first: true, text: '你在电子厂流水线干了三个月，手都磨出了茧。厂里在招线长，工资高一倍，要会来事。',
      choices: [
        { text: '去争线长，练胆练口才', effect: { kou: 6, shang: 3, tili: -3 }, addStatus: ['street'], log: '你第一次带人，学会了大吼也学会了讲理。' },
        { text: '攒钱要紧，别折腾', effect: { money: 20000, happy: -2 }, addStatus: ['street'], log: '晚上躺在铁架床上，你常想：这样下去何时是个头。' },
      ] },
    { id: 'c2', stage: 'gong', text: '下班路过夜市，卖炒粉的老板一晚能挣你一周工资。你站在摊前看了很久。',
      choices: [
        { text: '辞工，也去摆个摊', effect: { money: -8000, kou: 3 }, addStatus: ['street'], log: '第一个月差点亏光，可你学会了怎么吆喝。' },
        { text: '白天上班，晚上摆摊试试', effect: { money: 12000, tili: -6 }, log: '连轴转三个月，你瘦了十斤，但账上有了钱。' },
      ] },
    { id: 'c3', stage: 'gong', text: '老家的相亲对象来信，说家里让回去结婚、进厂，别再漂了。',
      choices: [
        { text: '回去安定下来', effect: { happy: 8 }, log: '你不甘心，但还是回去了。' },
        { text: '不回，想自己闯出名堂', effect: { xin: 5, happy: -5 }, log: '那封信你压在了箱底。' },
      ] },
    { id: 'c4', stage: 'gong', text: '同乡介绍你去给批发市场档口送货，天天见人谈价，你慢慢学会了看货、压价。',
      choices: [
        { text: '多听多看，跟老板套近乎', effect: { shang: 5, renmai: 5, tili: -3 }, log: '老板说你机灵，偶尔让你去谈小单。' },
        { text: '老实搬货，到点下班', effect: { tili: 3, money: 8000 }, log: '稳妥，可也错过了学本事的窗口。' },
      ] },
    { id: 'c5', stage: 'baitan', first: true, text: '你在大学城夜市租了个摊位卖小吃。学生口味刁，一条街十家同行。',
      choices: [
        { text: '琢磨差异化：自创招牌酱料', effect: { shang: 7, money: -5000 }, log: '酱料成了绝活，回头客多了。' },
        { text: '拼价格，薄利多销', effect: { money: 30000, tili: -5 }, log: '累成狗，但流水起来了。' },
      ] },
    { id: 'c6', stage: 'baitan', text: '隔壁摊位大叔教你看人流、时段、天气备货，说你光会炒不会算。',
      choices: [
        { text: '认真学记账算账', effect: { shang: 6, kou: 2 }, log: '你第一次知道什么叫毛利。' },
        { text: '觉得他小题大做', effect: { money: -8000, xin: -3 }, log: '一场大雨，你备的货全砸手里了。' },
      ] },
    { id: 'c7', stage: 'baitan', text: '城管来了几轮，摊位不让摆了。你半夜蹲在路边抽烟，想过放弃。',
      choices: [
        { text: '找正规铺面的机会', effect: { shang: 4, money: -15000 }, log: '你咬咬牙租下城中村的店面。' },
        { text: '先摆野摊游击战', effect: { money: 8000, xin: -5, renmai: -3 }, log: '心一直悬着，生意也做不大。' },
      ] },
    { id: 'c8', stage: 'baitan', text: '一个老顾客说他公司订餐量大，问你能不能做团体餐，但要垫资送货。',
      choices: [
        { text: '接！先垫资拿下客户', effect: { money: -10000, renmai: 8, shang: 3 }, addStatus: ['shop'], log: '你把店开起来了，供这家公司团餐。' },
        { text: '怕垫资回款慢，婉拒', effect: { kou: 2 }, log: '机会就这一次，错过了。' },
      ] },
    { id: 'c9', stage: 'baitan', text: '旺季连续通宵，你胃出血住院，店里靠雇的阿姨撑着，天天打电话问你。',
      choices: [
        { text: '养好身体，学着放手分权', effect: { tili: 10, shang: 3, money: -10000 }, log: '你开始明白：老板不是最累的那个。' },
        { text: '硬扛，怕店垮了', effect: { tili: -8, xin: 3 }, log: '出院那天你瘦得脱相。' },
      ] },
    { id: 'c10', stage: 'shop', first: true, text: '团餐生意稳了，可你发现原料被二道贩子赚走一大块。你决定自己跑产地。',
      choices: [
        { text: '亲自去产地谈直采', effect: { shang: 8, tili: -5, money: 20000 }, log: '成本降了两成，同行都来打听。' },
        { text: '维持现状，省心', effect: { happy: 2 }, log: '你看着别人的毛利眼热，却下不了狠心。' },
      ] },
    { id: 'c11', stage: 'shop', text: '老同学想入伙，出一笔钱占三成。他说他有渠道，你有手艺。',
      choices: [
        { text: '合作，各展所长', effect: { money: 100000, renmai: 8 }, addStatus: ['company'], log: '你俩把店做成了公司。' },
        { text: '怕被分权，婉拒', effect: { kou: 3 }, log: '你一个人扛着，走得慢些。' },
      ] },
    { id: 'c12', stage: 'shop', text: '有人举报你店里卫生有问题，市场监管来查。其实只是老对手使坏。',
      choices: [
        { text: '坦然配合检查，借机整改升级', effect: { xin: 6, kou: 4, money: -20000 }, log: '查完反而成了整改示范店。' },
        { text: '找关系想压下去', effect: { money: -30000, renmai: -5, xin: -3 }, log: '钱花了，心里更不踏实。' },
      ] },
    { id: 'c13', stage: 'shop', text: '生意最好的档口，房东要涨三倍租金，摆明是看你好赚。',
      choices: [
        { text: '据理力争，谈长期合同', effect: { kou: 6, money: -50000 }, log: '你赢了，也学会了谈判的底气。' },
        { text: '认了，先保住生意', effect: { money: -80000, xin: -4 }, log: '房东拿捏了你，这口气你记下了。' },
      ] },
    { id: 'c14', stage: 'shop', text: '父母催婚催得紧，你相亲认识了个踏实的人，对方不嫌你忙，只问一句能养家吗。',
      choices: [
        { text: '结婚，把日子过起来', effect: { happy: 12, money: -20000 }, addStatus: ['marriage'], log: '婚后的账，两个人一起算。' },
        { text: '再拼几年，别耽误人家', effect: { kou: 3, happy: -6 }, log: '你总觉得自己还没资格安定。' },
      ] },
    { id: 'c15', stage: 'gongsi', first: true, text: '电商风口来了，有人劝你把生意搬上网。你不太懂，可身边人都在刷手机买东西。',
      choices: [
        { text: '投钱学电商，招年轻人干', effect: { shang: 8, money: -100000, jishu: 3 }, addStatus: ['company', 'brand'], log: '三个月没单子，第四个月爆了。' },
        { text: '守好线下基本盘', effect: { money: 50000 }, log: '你稳住了，但也眼看着别人起飞。' },
      ] },
    { id: 'c16', stage: 'gongsi', text: '账上第一次有了七位数。会计提醒你：该理一理财务了。',
      choices: [
        { text: '请正规财务，合规经营', effect: { money: -30000, xin: 5, shang: 3 }, log: '规矩的钱，花得放心。' },
        { text: '找税筹打擦边球', effect: { money: 150000, xin: -8 }, addStatus: ['risk'], log: '省下的钱，夜里总让你心慌。' },
      ] },
    { id: 'c17', stage: 'gongsi', text: '爆单后你招了人，可老员工和新来的闹矛盾，管理一塌糊涂。',
      choices: [
        { text: '学管理，定制度分红', effect: { kou: 5, money: -20000, xin: 4 }, log: '铁打的营盘，终于有了规矩。' },
        { text: '靠义气管，谁闹谁走', effect: { renmai: -6, money: -50000 }, log: '核心的人走了一批，你才醒。' },
      ] },
    { id: 'c18', stage: 'gongsi', text: '风投找上门，要投五百万占两成，条件是烧钱换规模。',
      choices: [
        { text: '接融资，all in 扩规模', effect: { money: 500000, shang: 6 }, addStatus: ['invest', 'brand'], log: '烧钱那两年，你头发白了一半。' },
        { text: '不接，靠自有利润慢慢滚', effect: { money: 100000, xin: 5 }, log: '稳扎稳打，慢是真慢。' },
      ] },
    { id: 'c19', stage: 'gongsi', text: '孩子出生，你却在机场改签电话会议。妻子没说什么，抱着孩子先睡了。',
      choices: [
        { text: '把公司节奏调慢点，多回家', effect: { happy: 10, money: -30000 }, addStatus: ['kid'], log: '你学会了把周末留出来。' },
        { text: '趁风口再冲一冲', effect: { money: 200000, happy: -8 }, addStatus: ['kid'], log: '等你想回头陪时，孩子会跑了。' },
      ] },
    { id: 'c20', stage: 'zhongjian', first: true, text: '行业黑天鹅：上游原料暴涨三倍，账上现金只够撑三个月。',
      choices: [
        { text: '砍业务保现金，先活下来', effect: { money: -100000, xin: 5, shang: 4 }, log: '壮士断腕，你把公司保住了。' },
        { text: '赌一把：贷款囤原料', effect: { money: -600000, xin: -6 }, addStatus: ['debt'], log: '赌赢了翻身，赌输了……' },
      ] },
    { id: 'c21', stage: 'zhongjian', cond: s => s.status.has('debt') && s.money < 0, text: '银行催款电话一个接一个，发小劝你：跑了吧，换个城市重来。',
      choices: [
        { text: '不跑，谈展期、卖资产还债', effect: { xin: 10, money: -100000, renmai: 5 }, log: '你还清最后一笔那天，一个人在车里哭了。' },
        { text: '留下来，从头再来', effect: { xin: -5, happy: -8 }, addStatus: ['debt'], log: '你留了下来，从头再来。' },
      ] },
    { id: 'c22', stage: 'zhongjian', text: '一次行业大会，有人喊你X总，也有人背后说你暴发户。',
      choices: [
        { text: '不自满，多学多听', effect: { shang: 5, renmai: 4 }, log: '你记了半本笔记。' },
        { text: '飘了，到处讲成功学', effect: { kou: 3, renmai: -4, xin: -4 }, log: '台下点头的人，转头说你膨胀。' },
      ] },
    { id: 'c23', stage: 'zhongjian', text: '税务稽查来了，说你三年前那笔税筹有问题，要补税加罚款。',
      choices: [
        { text: '认罚整改，把账做干净', effect: { money: -200000, xin: 4 }, log: '这一课，学费不便宜。' },
        { text: '拖、找关系、想赖掉', effect: { money: -100000, xin: -10 }, addStatus: ['risk'], log: '事越拖越大。' },
      ] },
    { id: 'c24', stage: 'lao', first: true, text: '年过半百，你站在新盖的写字楼里，想起 2005 年那间出租屋。',
      choices: [
        { text: '开始培养接班人、做传承', effect: { xin: 4, shang: 2 }, addStatus: ['cun'], log: '你终于肯承认：要学会放手。' },
        { text: '亲自盯着，谁都不放心', effect: { tili: -6, happy: -3 }, log: '公司离不开你，你也离不开公司。' },
      ] },
    { id: 'c25', stage: 'lao', text: '有人出高价收购你的公司，价格够你全家三代衣食无忧。',
      choices: [
        { text: '卖了，落袋为安去享受生活', effect: { money: 8000000, happy: 10 }, addStatus: ['retired'], log: '签字那天你手有点抖，是激动也是不舍。' },
        { text: '不卖，这是你的一辈子', effect: { xin: 4, happy: 3 }, addStatus: ['retired'], log: '钱是一回事，事是另一回事。' },
      ] },
  ],

  small: [
    { id: 'cc1', text: '今天谈成一单，你奖励自己吃了碗加蛋的炒面。', effect: { happy: 3 } },
    { id: 'cc2', text: '供应商临时抬价，你气得摔了电话，又捡起来打回去讲价。', effect: { kou: 2, xin: -2 } },
    { id: 'cc3', text: '凌晨收摊，街边有人卖烤红薯，你买了两个，和伙计分着吃。', effect: { happy: 4 } },
    { id: 'cc4', text: '同行倒闭清仓，你低价盘了一批好设备。', effect: { shang: 2, money: -10000 } },
    { id: 'cc5', text: '你办了张健身卡，去了两次就再没去过。', effect: { money: -1000 } },
    { id: 'cc6', text: '老顾客带来新顾客，说他家的东西实在。', effect: { renmai: 2, money: 5000 } },
    { id: 'cc7', text: '台风天你硬要出车送货，轮胎打滑吓出一身冷汗。', effect: { tili: -4, xin: 2 } },
    { id: 'cc8', text: '回家过年，你给爸妈包了红包，他们说：别太累。', effect: { money: -5000, happy: 6 } },
  ],

  actions: [
    { key: 'xuexi', label: '📚 学经营/跑展会', desc: '看书、上课、跑展会', effect: { shang: 5, kou: 2 }, cost: 3000 },
    { key: 'dixia', label: '🤝 跑客户见人', desc: '拜访、请客、混圈子', effect: { kou: 4, renmai: 5, money: -5000 }, cost: 5000 },
    { key: 'tili', label: '🏃 锻炼身体', desc: '老板更要保重', effect: { tili: 6, health: 5 }, cost: 0 },
    { key: 'yanfa', label: '🔧 琢磨产品', desc: '亲自打磨，别全外包', effect: { jishu: 5, shang: 2 }, cost: 3000 },
    { key: 'xiuxi', label: '🛌 休整放空', desc: '绷太紧容易断', effect: { xin: 6, health: 4, tili: 3 }, cost: 0 },
  ],

  endings: [
    { id: 's_boss', tier: 'S', label: '行业标杆', cond: s => s.status.has('cun') && s.money > 3000000, story: '后来很多人写你的创业故事，可你知道，最难的从来不是赚钱，是一直有钱也不飘。' },
    { id: 'a_rich', tier: 'A', label: '身家千万的老板', cond: s => s.money > 500000 && !s.status.has('debt'), story: '你实现了自己当老板的梦，也学会了老板最怕的不是亏，是没人一起扛。' },
    { id: 'b_live', tier: 'B', label: '稳稳过日子的生意人', cond: s => s.money > 100000, story: '没做成巨头，可你有店、有房、有家人，日子踏实。' },
    { id: 'c_debt', tier: 'C', label: '大起大落终上岸', cond: s => s.status.has('debt') && s.money >= 0, story: '你欠过巨债，也咬着牙还清了。这辈子的起落，够写一本书。' },
    { id: 'd_broke', tier: 'D', label: '一败涂地', cond: s => s.status.has('debt') && s.money < 0, story: '你赌输了一次大的。出租屋的灯还亮着，你在算还有多少债要还。', dark: true },
    { id: 'c_plain', tier: 'C', label: '平凡而完整', cond: () => true, story: '你没暴富也没破产，做过小生意，起起落落，最后过着普通的日子。也挺好。' },
  ],

  achievements: [
    { id: 'cc1', label: '第一桶金', cond: s => s.money > 50000 },
    { id: 'cc2', label: '当上老板', cond: s => s.status.has('company') },
    { id: 'cc3', label: '有了品牌', cond: s => s.status.has('brand') },
    { id: 'cc4', label: '拿到融资', cond: s => s.status.has('invest') },
    { id: 'cc5', label: '白手起家百万', cond: s => s.money > 1000000 },
    { id: 'cc6', label: '诚信纳税', cond: s => !s.status.has('risk') && s.status.has('company') },
    { id: 'cc7', label: '组建家庭', cond: s => s.status.has('marriage') },
    { id: 'cc8', label: '绝地还清', cond: s => s.status.has('debt') && s.money > 0 },
    { id: 'cc9', label: '创业教父', cond: s => s.status.has('cun') },
    { id: 'cc10', label: '身体是本钱', cond: s => s.tili >= 55 },
  ],
};

export default CY;
