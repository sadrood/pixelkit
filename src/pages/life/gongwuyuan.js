// 成长模拟器 · 剧本①：重生之我是公务员
// 属性：pen笔杆子 so会来事 vita酒量体能 clean廉洁定力 exam考运 guanxi人脉；money(元)/health/happy
// 事件字段：id stage text first? cond?(s)=>bool choices[{text,need?,effect,addStatus,removeStatus,log}]
export const GW = {
  id: 'gongwuyuan',
  title: '重生之我是公务员',
  tagline: '2001 年，你重生了。前世蹉跁半生，这一世你打定主意：进体制，端稳这碗饭。',
  startYear: 2001,
  pickHint: '千军万马过独木桥，你偏要走这条路',

  stageIntros: {
    study: ['大学的日子晃晃悠悠，但你想得很清楚：这条路，通向体制。', '大学四年转眼到头。你要去撞那扇千军万马的门了。'],
    gaokao: ['毕业即分水岭。你提笔上阵，千军万马过独木桥。', '你上岸了。乡镇，是体制给新人的第一课。'],
    grassroots: ['乡镇是最小也是最大的课堂：写材料、值夜班、走村入户。', '乡镇几年，你摸清了基层的脾气，也攒下了资历。'],
    mid: ['你开始摸到体制的门道，也摸到它的另一边。', '中坚岁月将尽，往上是峭壁，往下是平川。'],
    top: ['越往上走，风越大，每一步都要想清楚。', '高处岁月将尽，该想想退休后的生活了。'],
    old: ['岁月不饶人，你也不饶岁月。', '你这一生的账，该盘一盘了。'],
  },

  attrMeta: {
    pen: { label: '笔杆子' }, so: { label: '会来事' }, vita: { label: '酒量体能' },
    clean: { label: '廉洁定力' }, exam: { label: '考运' }, guanxi: { label: '人脉' },
  },

  statuses: [
    { key: 'activist', label: '入党积极分子' },
    { key: 'civil', label: '在编公务员' },
    { key: 'township', label: '乡镇干部' },
    { key: 'core_dept', label: '核心部门' },
    { key: 'rich_pen', label: '笔杆子', desc: '材料一稿过的传说' },
    { key: 'chujia', label: '拟提拔对象' },
    { key: 'chuji', label: '处级干部' },
    { key: 'tingji', label: '厅级干部' },
    { key: 'marriage', label: '已婚' },
    { key: 'kid', label: '为人父母', desc: '养娃费钱又费心' },
    { key: 'blessed', label: '儿孙满堂' },
    { key: 'debt', label: '房奴/负债', desc: '每月工资先还贷' },
    { key: 'sick', label: '慢性病', desc: '体检单不再好看' },
    { key: 'edge', label: '被边缘化', desc: '开会没人叫你' },
    { key: 'risk', label: '廉政风险', desc: '有些钱不该拿也拿了', danger: true },
    { key: 'investigated', label: '被调查', desc: '纪委请你喝茶', danger: true },
    { key: 'retired', label: '退休干部' },
  ],

  income: [
    { if: 'tingji', per: 260000 }, { if: 'chuji', per: 160000 },
    { if: 'core_dept', per: 100000 }, { if: 'chujia', per: 85000 },
    { if: 'township', per: 60000 }, { if: 'civil', per: 45000 },
    { if: 'retired', per: 100000 },
  ],

  backgrounds: [
    { id: 'worker', label: '工人家庭', desc: '父母都是工厂工人，供你读书已是不易。没有关系没有钱，一切靠自己。', money: 8000, init: { pen: 45, so: 40, vita: 62, clean: 64, exam: 55, guanxi: 12 } },
    { id: 'cadre', label: '基层干部家庭', desc: '父亲是县里的小干部，你从小懂一些体制里的门道。', money: 20000, init: { pen: 50, so: 56, vita: 50, clean: 54, exam: 50, guanxi: 36 } },
    { id: 'biz', label: '经商家庭', desc: '家里不缺钱，可父母总说：挣再多，不如端铁饭碗体面。', money: 80000, init: { pen: 48, so: 52, vita: 48, clean: 40, exam: 52, guanxi: 24 } },
  ],

  cheats: [
    { id: 'none', label: '不选外挂', desc: '就当自己运气好，多活了一世。', effect: {} },
    { id: 'memory', label: '过目不忘（考运 +12）', desc: '前世背过的题还记得七八成。', effect: { exam: 12 } },
    { id: 'foresight', label: '先知（2003 会有一轮机构改革）', desc: '记得关键节点，能提前站队。', effect: { exam: 0 } },
    { id: 'steady', label: '沉稳心性（廉洁定力 +10）', desc: '吃过大亏的人，最懂分寸。', effect: { clean: 10 } },
  ],

  stages: [
    { id: 'study', label: '求学 · 大学', year: [2001, 2004], rounds: 4, actionSlots: 1 },
    { id: 'gaokao', label: '上岸 · 考公', year: [2004, 2006], rounds: 4, actionSlots: 1 },
    { id: 'grassroots', label: '基层 · 乡镇', year: [2006, 2013], rounds: 5, actionSlots: 2 },
    { id: 'mid', label: '中坚 · 县市', year: [2013, 2021], rounds: 6, actionSlots: 2 },
    { id: 'top', label: '高处 · 厅处', year: [2021, 2029], rounds: 4, actionSlots: 1 },
    { id: 'old', label: '晚年 · 回望', year: [2029, 2042], rounds: 3, actionSlots: 1 },
  ],

  big: [
    { id: 's1', stage: 'study', first: true, text: '大二宿舍夜谈，室友问：毕业想干嘛？',
      choices: [
        { text: '考公务员，端铁饭碗', effect: { exam: 4, pen: 2 }, log: '你把考公说得斩钉截铁。' },
        { text: '先考研再说', effect: { exam: 3 }, log: '读书总不会错。' },
        { text: '走一步看一步', effect: { happy: 5 }, log: '年轻人嘛，谁还没点迷茫。' },
      ] },
    { id: 's2', stage: 'study', text: '系里组织写入党申请书，3000 字，你对着白纸发怵。',
      choices: [
        { text: '认真写，当练笔', effect: { pen: 6, so: 3 }, addStatus: ['activist'], log: '字字真心（至少看起来是）。' },
        { text: '找学长要模板抄', effect: { pen: -1, so: 2 }, log: '快是快，总觉得缺了点什么。' },
      ] },
    { id: 's3', stage: 'study', text: '寒假回家，父母旧话重提：毕业去哪？要托你二叔问问厂里不？',
      choices: [
        { text: '告诉他们我要考公', effect: { exam: 3, pen: 1, happy: -2 }, log: '父母沉默半晌：行，好好考。' },
        { text: '含含糊糊混过去', effect: { so: 2, happy: 1 }, log: '有些话，考上再说。' },
      ] },
    { id: 's4', stage: 'study', text: '同系女生约你去图书馆，在走廊小声问：你以后想留在这座城市吗？',
      choices: [
        { text: '认真回应，珍惜这段感情', effect: { happy: 8, so: 2, exam: -2 }, log: '大学爱情最不讲成本。' },
        { text: '以备考为由婉拒', effect: { exam: 3, happy: -4 }, log: '感情这种事，也讲时机。' },
      ] },
    { id: 's5', stage: 'study', text: '系主任让你牵头暑期下乡调研，要一个月，占用复习时间。',
      choices: [
        { text: '接下，锻炼也挣表现', effect: { pen: 5, so: 4, exam: -2 }, log: '简历上多了漂亮一笔。' },
        { text: '推掉，安心备考', effect: { exam: 4 }, log: '主线任务是上岸。' },
      ] },
    { id: 's6', stage: 'study', text: '你去做家教，家长是退休老教师，问：年轻人想不想吃公家饭？我那有套申论笔记。',
      choices: [
        { text: '诚心求教', effect: { pen: 5, exam: 5, money: -500 }, log: '老教师倾囊相授。' },
        { text: '婉谢，按自己的计划来', effect: { exam: 2 }, log: '谢过好意，你自有章法。' },
      ] },
    { id: 's7', stage: 'study', text: '期末复习周连熬四天，你头晕眼花，室友劝你先睡一觉。',
      choices: [
        { text: '硬撑到考完', effect: { exam: 3, health: -8 }, log: '考完你瘫了两天。' },
        { text: '好好睡一晚', effect: { health: 6, exam: -2 }, log: '身体是本钱。' },
      ] },
    { id: 's8', stage: 'study', text: '高中铁哥们来借钱，说家里急用，眼圈发红。',
      choices: [
        { text: '借他两千', effect: { guanxi: 4, money: -2000, happy: 2 }, log: '兄弟就是拿来帮的。' },
        { text: '婉拒，说自己也没钱', effect: { guanxi: -4, happy: -2 }, log: '有些情分，一开口就远了。' },
      ] },
    { id: 'g1', stage: 'gaokao', first: true, text: '国考报名，市直岗只招 1 人，乡镇岗招 5 人，报录比天差地别。',
      choices: [
        { text: '冲市直岗', need: s => s.exam >= 62, effect: {}, log: '搏一搏，单车变摩托。' },
        { text: '稳报乡镇岗', effect: { exam: 6 }, log: '先上岸再说，平台能慢慢换。' },
      ] },
    { id: 'g2', stage: 'gaokao', text: '笔试过线进面试。培训班最后模拟，老师问：你为什么报考公务员？',
      choices: [
        { text: '为人民服务', effect: { so: 4 }, log: '标准答案，过！' },
        { text: '想要一份稳定的生活', effect: { pen: 2 }, log: '真诚，但考官爱听前面那句。' },
      ] },
    { id: 'g3', stage: 'gaokao', text: '面试当天你抽到最后一个号，等到下午。主考官临时加问：如果基层很苦，你能坚持吗？',
      choices: [
        { text: '答得诚恳有力', effect: { so: 5, clean: 2 }, log: '主考官微微点头。' },
        { text: '紧张卡壳，强行圆场', effect: { so: -3, exam: -2 }, log: '出了考场你懊恼了一晚上。' },
      ] },
    { id: 'g4', stage: 'gaokao', text: '你入围了！但体检通知写：血压偏高需复检。',
      choices: [
        { text: '清淡早睡，认真调养', effect: { vita: 4, health: 4 }, log: '复检顺利通过。' },
        { text: '托人打听能不能通融', effect: { so: 2, clean: -8 }, log: '被批了一顿，还是老实复检。' },
      ] },
    { id: 'g5', stage: 'gaokao', text: '政审人员来学校了解情况，室友说你热心踏实，也有人说你有点闷。',
      choices: [
        { text: '顺其自然，材料都真实', effect: { clean: 3 }, log: '政审没刁难你。' },
        { text: '连夜找同学对口径', effect: { so: -4, clean: -6 }, log: '越描越黑，好在没出事。' },
      ] },
    { id: 'g6', stage: 'gaokao', text: '录用公示结束，你被分到最基层的乡镇。报到前夜，你在宿舍打包行李。',
      choices: [
        { text: '平静接受：从哪开始都是开始', effect: { happy: 4, so: 2 }, addStatus: ['civil', 'township'], log: '你正式成了体制内的人。' },
        { text: '心里委屈：为何是乡镇', effect: { happy: -4 }, addStatus: ['civil', 'township'], log: '先待着吧，路是人走出来的。' },
      ] },
    { id: 'g7', stage: 'gaokao', text: '报到第一天，主任让你先认人：这个镇 21 个村，先跑一遍。',
      choices: [
        { text: '借辆自行车，一周跑完', effect: { vita: 6, guanxi: 4, so: 3 }, log: '混了个脸熟，也磨破了裤子。' },
        { text: '先在办公室等安排', effect: { pen: 2 }, log: '稳，但少了点印象分。' },
      ] },
    { id: 'b1', stage: 'grassroots', first: true, text: '党政办第二周，主任把全单位最没人愿写的年度总结扔给你：一周内交初稿。',
      choices: [
        { text: '通宵打磨，一周交稿', effect: { pen: 9, health: -4 }, addStatus: ['rich_pen'], log: '主任翻完，难得点了点头。' },
        { text: '抄去年的改个年份', effect: { pen: -5 }, log: '要是一眼被看穿……' },
        { text: '请老同事吃饭请教', effect: { pen: 3, money: -600 }, log: '饭桌上学了不少门道。' },
      ] },
    { id: 'b2', stage: 'grassroots', text: '防汛值守夜，半夜电话响：下游村支书报险情。',
      choices: [
        { text: '立刻核实上报', effect: { so: 6, health: -3 }, log: '凌晨三点你报到了县里，镇长点名表扬。' },
        { text: '先问清是不是虚报', effect: { so: 2 }, log: '稳妥是稳妥，可有时差那几分钟。' },
      ] },
    { id: 'b3', stage: 'grassroots', text: '县里借调要人写材料，单位推荐了你。可借调常常只借不调。',
      choices: [
        { text: '去，多见识见识', effect: { pen: 6, so: 3, guanxi: 3 }, log: '借调一年，你认识了县里半个办公室。' },
        { text: '不去，留在乡镇图安稳', effect: { happy: 2, so: -1 }, log: '机会像雨，淋着淋着就停了。' },
      ] },
    { id: 'b4', stage: 'grassroots', text: '换届年，组织上来谈话了解原镇长情况。',
      choices: [
        { text: '实事求是', effect: { so: 3, clean: 4 }, log: '组织上欣赏说真话的人。' },
        { text: '只说好话不得罪人', effect: { so: 5, clean: -4 }, log: '谁都不得罪，也谁都靠不住。' },
      ] },
    { id: 'b5', stage: 'grassroots', text: '两户村民因宅基地地界动手，书记让你去调解。',
      choices: [
        { text: '拉上老治保主任上门', effect: { so: 5, guanxi: 3 }, log: '人熟地熟，半天说和。' },
        { text: '直接摆法规条例', effect: { pen: 2, so: -3 }, log: '法理讲清了，情面没了。' },
      ] },
    { id: 'b6', stage: 'grassroots', text: '你汇总的报表被县里通报数据错误，主任替你扛了，私下让你长点心。',
      choices: [
        { text: '写检查，梳理流程', effect: { pen: 4, clean: 2 }, log: '你给报表加了三道复核。' },
        { text: '觉得是口径问题，不服', effect: { so: -5, pen: -2 }, log: '顶撞主任，你被晾了三个月。' },
      ] },
    { id: 'b7', stage: 'grassroots', text: '镇中学的年轻女老师总在食堂坐你对面，渐渐话多了。',
      choices: [
        { text: '主动些，约她周末赶集', effect: { happy: 7, so: 2 }, log: '乡镇的爱情，简单也滚烫。' },
        { text: '先立业后成家，保持距离', effect: { exam: 2, happy: -3 }, log: '你总觉得自己还没站稳。' },
      ] },
    { id: 'b8', stage: 'grassroots', text: '县里集资建房，三千一平。首付你凑得出，可之后每月还贷会压得人喘不过气。',
      choices: [
        { text: '咬牙买下，也算有个窝', effect: { money: -120000, happy: 6 }, addStatus: ['debt'], log: '从此工资先还贷，再谈生活。' },
        { text: '不买，攒钱以后再说', effect: { happy: -3 }, log: '租的房子也能住人。' },
      ] },
    { id: 'b9', stage: 'grassroots', text: '驻村一年，你在村里吃住，晒成黑炭。村支书说：这娃能吃苦。',
      choices: [
        { text: '索性吃住都在村上', effect: { guanxi: 5, so: 4, health: -3 }, log: '你被村民当成了自家人。' },
        { text: '每周回镇上休整', effect: { health: 3 }, log: '劳逸结合，才能走远。' },
      ] },
    { id: 'm1', stage: 'mid', first: true, text: '你借调进县政府办。一次接待上级检查组，白酒三杯下肚，组长的敬酒词还在继续。',
      choices: [
        { text: '舍命陪君子', effect: { so: 6, vita: -9, health: -5 }, addStatus: ['core_dept'], log: '这顿酒没白喝，你被记住了。' },
        { text: '以茶代酒说酒精过敏', effect: { so: -3, health: 2 }, log: '保住了身体，也丢了点印象分。' },
        { text: '硬撑半杯，借故离席吐了再回', effect: { so: 2, vita: -4 }, log: '狠人。' },
      ] },
    { id: 'm2', stage: 'mid', text: '机构改革风声起：你要么去新成立的部门，要么留原处。',
      choices: [
        { text: '主动请缨去新部门', effect: { so: 6, exam: 2 }, addStatus: ['chujia'], log: '新部门缺人，你成了第一批。' },
        { text: '留在原处以稳为主', effect: { so: -2, happy: 2 }, log: '风浪越大鱼越贵，可你不缺鱼。' },
      ] },
    { id: 'm3', stage: 'mid', text: '一位老板趁你落单塞来一个信封，说是过节费，下周恰好要审他的项目。',
      choices: [
        { text: '拒收并按规定上报', effect: { clean: 12, so: -3 }, log: '你守住了那条线。' },
        { text: '收下放抽屉里不动', effect: { money: 30000, clean: -22 }, addStatus: ['risk'], log: '有些信封，收了就再难放下。' },
        { text: '婉拒但不举报，留个人情', effect: { clean: 4, guanxi: 3 }, log: '不沾手，也别结怨。' },
      ] },
    { id: 'm4', stage: 'mid', text: '干部考察组来谈话，拟提拔你为副处级。',
      choices: [
        { text: '表态服从组织安排', effect: { so: 6 }, addStatus: ['chuji'], log: '公示顺利，你成了处级。' },
        { text: '想争取对口专业岗位', effect: { so: 2, pen: 3 }, addStatus: ['chuji'], log: '组织上尊重了你的意见。' },
      ] },
    { id: 'm5', stage: 'mid', cond: s => s.status.has('risk'), text: '收了钱的人总会有第二次。这次老板更直接：一辆新车借你开，条件只字未提。',
      choices: [
        { text: '收下，他懂的我也懂', effect: { money: 150000, clean: -30 }, addStatus: ['risk'], log: '绳子越套越紧。' },
        { text: '推回去：以后别这样', effect: { clean: 8, so: -4 }, log: '有些口子，开不得第二次。' },
      ] },
    { id: 'm6', stage: 'mid', text: '单位同事大都结婚了。你那位（或相亲对象）问：我们是不是也该定下来了？',
      choices: [
        { text: '顺势结婚', effect: { happy: 10, money: -30000 }, addStatus: ['marriage'], log: '婚礼不大，敬酒的人很多。' },
        { text: '再拼几年事业', effect: { so: 3, happy: -5 }, log: '她把话说得很淡，可你听得出失落。' },
      ] },
    { id: 'm7', stage: 'mid', cond: s => s.status.has('marriage'), text: '妻子怀孕了。产检、奶粉、学区处处要用钱，可房子还是老破小。',
      choices: [
        { text: '咬牙置换学区房', effect: { money: -600000, happy: 4 }, addStatus: ['debt'], log: '三十年的贷款，换孩子一个好起点。' },
        { text: '不折腾，就近上学也挺好', effect: { happy: 3 }, log: '你把焦虑咽了回去。' },
      ] },
    { id: 'm8', stage: 'mid', cond: s => s.status.has('marriage'), text: '孩子出生那晚你在产房外，护士出来说母子平安。你眼眶一热。',
      choices: [
        { text: '抱紧这个家', effect: { happy: 12 }, addStatus: ['kid'], log: '当爹的第一夜，你几乎没合眼。' },
        { text: '心里沉甸甸：要更拼了', effect: { so: 3, happy: 2 }, addStatus: ['kid'], log: '为了孩子，你得更往上走。' },
      ] },
    { id: 'm9', stage: 'mid', text: '母亲住院动手术，医生直说风险。你在走廊坐了一整夜。',
      choices: [
        { text: '请长假陪护', effect: { so: -5, happy: 6, money: -20000 }, log: '母亲出院那天攥着你的手没说话。' },
        { text: '请护工，忙完再去看', effect: { so: 3, happy: -8 }, log: '后来你一直觉得亏欠。' },
      ] },
    { id: 'm10', stage: 'mid', text: '同学会十年聚，下海的同学开奔驰来的，席间笑问：处座，一个月工资够加油不？',
      choices: [
        { text: '自嘲一笑，不往心里去', effect: { happy: 3, clean: 4 }, log: '你清楚自己图的是什么。' },
        { text: '心里翻江倒海，回家失眠', effect: { happy: -6, clean: -3 }, log: '那晚你第一次觉得穷字扎眼。' },
      ] },
    { id: 't1', stage: 'top', first: true, text: '省里来调研，点名听你汇报。稿子你自己写的，你念得字正腔圆。',
      choices: [
        { text: '趁机提一个切实可行的建议', effect: { so: 7, pen: 3 }, addStatus: ['tingji'], log: '省领导当场让秘书记下来。' },
        { text: '不求有功但求无过', effect: { pen: 1 }, log: '稳字当头。' },
      ] },
    { id: 't2', stage: 'top', text: '巡视组进驻你所在的部门，隔壁单位处长已被带走问话。',
      choices: [
        { text: '主动梳理手头项目，该补的补', effect: { clean: 8 }, log: '清清白白，心里不虚。' },
        { text: '找前辈打听巡视组动向', effect: { so: 2, clean: -6, guanxi: -3 }, log: '打听是打听了，心里更没底。' },
      ] },
    { id: 't3', stage: 'top', text: '体检单：三高+重度脂肪肝。医生说再这么喝，命都要搭进去。',
      choices: [
        { text: '戒酒，重新锻炼', effect: { vita: 9, health: 12, so: -4 }, log: '该说不的时候，要学会说不。' },
        { text: '应酬能躲就躲', effect: { health: 5, so: -2 }, addStatus: ['sick'], log: '有些债，年纪大了要还。' },
      ] },
    { id: 't4', stage: 'top', cond: s => s.status.has('risk') && s.clean < 60, text: '你被实名举报了。材料很详实：哪年、哪笔、哪个项目，一笔一笔列得清清楚楚。',
      choices: [
        { text: '向组织如实说明，争取主动', effect: { clean: 18, so: -10 }, log: '组织念你主动，给了一次机会。' },
        { text: '心存侥幸，想先稳住阵脚', effect: { so: -5, clean: -12 }, addStatus: ['investigated'], log: '谈话室里，灯光比想象中亮。' },
      ] },
    { id: 't5', stage: 'top', text: '儿子高考差三分上省重点，招生那头有人递话：处座，这事可以操作。',
      choices: [
        { text: '按规矩来，绝不越线', effect: { clean: 12, so: -5, happy: -2 }, log: '你对儿子说：爸爸不能坏这个规矩。' },
        { text: '找人协调了一下', effect: { so: 3, money: -80000, clean: -18 }, addStatus: ['risk'], log: '儿子进去了，可你知道那根线断了。' },
      ] },
    { id: 't6', stage: 'top', text: '退休多年的老领导找你，想让你给他亲戚的招标行个方便。',
      choices: [
        { text: '婉拒，说程序上过不去', effect: { clean: 8, guanxi: -4 }, log: '老领导没再说什么，电话再也没响过。' },
        { text: '帮他打声招呼', effect: { guanxi: 5, clean: -12 }, addStatus: ['risk'], log: '人情是还了，账却记下了。' },
      ] },
    { id: 't7', stage: 'top', text: '单位组织体检，你的心脏彩超有个待复查的阴影。那晚你对着报告发很久呆。',
      choices: [
        { text: '立刻复查，别再拖了', effect: { health: 10, money: -5000 }, log: '结果是良性。你长舒一口气。' },
        { text: '工作太忙，先放放', effect: { health: -8, so: 3 }, addStatus: ['sick'], log: '有些东西，等不起。' },
      ] },
    { id: 't8', stage: 'top', text: '老家发小来省城办事，酒桌上半真半假提：你那老屋的地，有人出价了。',
      choices: [
        { text: '听出话里有话，严词回绝', effect: { clean: 10, guanxi: -3 }, log: '水有多深，你心里有数。' },
        { text: '让他把话说明白', effect: { money: 200000, clean: -18 }, addStatus: ['risk'], log: '钱到账那天，你心里莫名发慌。' },
      ] },
    { id: 'o1', stage: 'old', first: true, text: '组织谈话：到龄了，准备退下来。你坐在办公室，看着窗外梧桐树，发了很久呆。',
      choices: [
        { text: '坦然交接，站好最后一班岗', effect: { happy: 6, so: 3 }, addStatus: ['retired'], log: '后任说：向老领导学习。' },
        { text: '抓紧办几件一直想办的事', effect: { happy: 9 }, addStatus: ['retired'], log: '有些事再不做，就没机会了。' },
      ] },
    { id: 'o2', stage: 'old', text: '退休第二年，老同事要编老照片集，邀你写篇序。',
      choices: [
        { text: '写，用了一辈子的笔杆子', effect: { pen: 5, happy: 6 }, addStatus: ['blessed'], log: '序写得好，很多人转给你看。' },
        { text: '婉拒，想多陪家人', effect: { happy: 7 }, log: '一辈子写够了材料，这次留给自己。' },
      ] },
    { id: 'o3', stage: 'old', text: '儿女想在大城市买房，首付差一截，电话里欲言又止。',
      choices: [
        { text: '把积蓄给他们凑上', effect: { money: -300000, happy: 8 }, log: '儿孙自有儿孙福，可你总想帮一把。' },
        { text: '让他们自己再努努力', effect: { happy: -3 }, log: '帮得了一时，帮不了一世。' },
      ] },
    { id: 'o4', stage: 'old', text: '一起喝过酒、搭过班子的老伙计走了。追悼会上你看着照片，忽然明白了很多。',
      choices: [
        { text: '开始整理自己的一辈子', effect: { happy: -2, pen: 3 }, log: '你决定写本回忆录。' },
        { text: '更爱惜身体，多走动', effect: { health: 8, happy: 3 }, log: '活着的人，要替走了的人好好活。' },
      ] },
    { id: 'o5', stage: 'old', text: '组织部请你回机关讲讲如何写好材料，台下坐着一屋子年轻人。',
      choices: [
        { text: '倾囊相授，讲了三个小时', effect: { pen: 4, happy: 6 }, log: '散场时有人找你签名。' },
        { text: '简单讲讲，留点余地', effect: { happy: 2 }, log: '有些门道，要自己趟过才懂。' },
      ] },
    { id: 'o6', stage: 'old', text: '孙女问你：爷爷，这一辈子最得意的事是什么？',
      choices: [
        { text: '想了想：没做过亏心事', effect: { happy: 10, clean: 5 }, log: '这句话，你对得起自己。' },
        { text: '逗她：当年可是考过第一的', effect: { happy: 5 }, log: '小丫头咯咯笑，你笑得比她大声。' },
      ] },
    { id: 'o7', stage: 'old', text: '清理办公室旧物，你翻出二十年前第一份被打了八遍的年度总结。',
      choices: [
        { text: '收好，留给孙子当传家宝', effect: { happy: 6 }, log: '上面还有主任当年的批注。' },
        { text: '笑了笑，扔进碎纸机', effect: { happy: 2 }, log: '那些年的苦，都过去了。' },
      ] },
  ],

  small: [
    { id: 'sm1', text: '食堂阿姨今天多给你打了一勺红烧肉：加班的小伙子辛苦了。', effect: { happy: 3 } },
    { id: 'sm2', text: '同事孩子满月，你随了份子又被拉着喝了一顿。', effect: { money: -600, so: 2 } },
    { id: 'sm3', text: '下雨天你把伞借给没带伞的老同事，自己淋着跑回去。', effect: { so: 3, health: -1 } },
    { id: 'sm4', text: '听说隔壁在办电脑培训班，你报了名，夜校破旧但讲得不错。', effect: { exam: 3 } },
    { id: 'sm5', text: '周末回老家帮父母干了一天农活，腰酸背痛心里踏实。', effect: { happy: 4, health: -1 } },
    { id: 'sm6', text: '你在旧书摊淘到《党政机关公文写作》，挑灯夜读。', effect: { pen: 3 } },
    { id: 'sm7', text: '打印机又卡纸，你蹲在地上修了半天，满手墨水。', effect: { happy: -2, pen: 1 } },
    { id: 'sm8', text: '多年不见的高中同桌联系你，说想合伙做点小生意。', effect: { guanxi: 2 } },
    { id: 'sm9', text: '年底评优你被提名，最后花落别人。你笑笑：明年再来。', effect: { happy: -2, so: 2 } },
    { id: 'sm10', text: '你坚持晨跑一年，体检单上的箭头少了几个。', effect: { vita: 4, health: 6 } },
    { id: 'sm11', text: '邻居孩子拿着作业本敲门，你讲了半小时鸡兔同笼。', effect: { so: 2, happy: 2 } },
    { id: 'sm12', text: '工资到账那天，你先把贷款还了、辅导费交了，卡里剩几百。', effect: { happy: -2 } },
  ],

  actions: [
    { key: 'study', label: '📚 学习进修', stages: ['study', 'gaokao', 'grassroots', 'mid'], desc: '刷题、考证、读在职研究生', effect: { exam: 6, pen: 2, happy: -2 }, cost: 1000 },
    { key: 'fitness', label: '🏃 健身锻炼', desc: '晨跑、打球，攒好身体', effect: { vita: 5, health: 4 }, cost: 0 },
    { key: 'social', label: '🍵 请客社交', stages: ['gaokao', 'grassroots', 'mid', 'top'], desc: '喝茶吃饭，攒人脉', effect: { so: 5, guanxi: 4, money: -8000 }, cost: 8000 },
    { key: 'material', label: '✍️ 揽写材料', stages: ['grassroots', 'mid', 'top'], desc: '多写多练，让领导看见', effect: { pen: 8, so: 2, health: -3 }, cost: 0 },
    { key: 'rest', label: '🛌 躺平休整', desc: '保命要紧，缓一缓', effect: { health: 6, happy: 6, so: -3 }, cost: 0 },
    { key: 'fuxi', label: '📝 备考刷题', stages: ['study', 'gaokao'], desc: '行测申论刷到吐', effect: { exam: 10, happy: -4 }, cost: 0 },
  ],

  endings: [
    { id: 's_high', tier: 'S', label: '高处不胜寒，但你上去了', cond: s => s.status.has('tingji') && !s.status.has('investigated'), story: '从乡镇的第一次写材料，到红头文件上签下你的名字。退休那天你回头看：那条路，你没有白走。' },
    { id: 'a_mid', tier: 'A', label: '处级安稳一生', cond: s => s.status.has('chuji') && !s.status.has('investigated'), story: '没有大起大落，可每个关键节点你都稳住了。别人称你老处长，你笑笑：安稳也是本事。' },
    { id: 'b_civil', tier: 'B', label: '单位的中坚', cond: s => s.status.has('civil') && s.clean >= 55, story: '你没站上顶峰，可单位的文件、会议、考核离了你转不动。退休时，年轻同事喊你一声老师傅。' },
    { id: 'c_edge', tier: 'C', label: '提前转身', cond: s => s.status.has('edge') && !s.status.has('investigated'), story: '你渐渐边缘，索性提前内退。有人说你怂，你说：人这一辈子，又不只是填报表。' },
    { id: 'd_down', tier: 'D', label: '出事了', cond: s => s.status.has('investigated') || (s.status.has('risk') && s.clean < 45), story: '有些字不该签，有些酒不该喝，有些信封不该收。留置室的灯很亮，你想起 2001 年那个想改变命运的自己。', dark: true },
    { id: 'c_mid', tier: 'C', label: '普通而完整的一生', cond: () => true, story: '你没能登顶，也没出事。就这样在体制里过了大半辈子，有升迁的欣喜，也有背锅的委屈。平凡，但完整。' },
  ],

  achievements: [
    { id: 'a1', label: '上岸成功', cond: s => s.status.has('civil') },
    { id: 'a2', label: '笔杆子传说', cond: s => s.status.has('rich_pen') },
    { id: 'a3', label: '进核心部门', cond: s => s.status.has('core_dept') },
    { id: 'a4', label: '晋到处级', cond: s => s.status.has('chuji') },
    { id: 'a5', label: '晋到厅级', cond: s => s.status.has('tingji') },
    { id: 'a6', label: '全身而退', cond: s => s.status.has('risk') && !s.status.has('investigated') && s.clean >= 60 },
    { id: 'a7', label: '组建家庭', cond: s => s.status.has('marriage') },
    { id: 'a8', label: '养儿育女', cond: s => s.status.has('kid') },
    { id: 'a9', label: '儿孙满堂', cond: s => s.status.has('blessed') },
    { id: 'a10', label: '长命安康', cond: s => !s.status.has('sick') && s.vita >= 60 },
    { id: 'a11', label: '人间清醒', cond: s => !s.status.has('risk') && s.clean >= 70 },
  ],
};

export default GW;
