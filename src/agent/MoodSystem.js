/**
 * MoodSystem - AI 助手霓虹颜文字情绪系统
 * 独立模块，可从 AgentPage 中解耦
 * 
 * 统一使用颜文字风格（Pixel / Kit 徽章都是颜文字），不使用 emoji。
 * 聊天内容层面另做处理：Kit prompt 约定只用颜文字，sanitizeDebateReply 负责去 emoji。
 */
export const MOODS = {
  happy:    { face:'(◕‿◕)',     label:'开心', color:'#f5a623', anim:'anim-bounce' },
  excited:  { face:'✧(>o<)✧',   label:'兴奋', color:'#ff6b9d', anim:'anim-vibrate' },
  proud:    { face:'(￣▽￣)',    label:'得意', color:'#7c6ff7', anim:'anim-nod' },
  healing:  { face:'(｡•́︿•̀｡)',  label:'治愈', color:'#34d9a0', anim:'anim-float' },
  shy:      { face:'(〃ω〃)',    label:'害羞', color:'#f78da7', anim:'anim-wobble' },
  thinking: { face:'(。-ω-)',    label:'思考', color:'#22d3ee', anim:'anim-tilt' },
  confused: { face:'(・_・;)',   label:'疑惑', color:'#a0a0b8', anim:'anim-shake' },
  surprised:{ face:'(⊙▽⊙)',    label:'惊讶', color:'#f5a623', anim:'anim-pop' },
  sad:      { face:'(´；ω；`)',  label:'难过', color:'#6b7280', anim:'anim-droop' },
  angry:    { face:'(｀へ´)',    label:'生气', color:'#f04860', anim:'anim-quake' },
  worried:  { face:'(・_・;)ゞ', label:'担心', color:'#e8c840', anim:'anim-fidget' },
  chill:    { face:'(￣ω￣)',    label:'淡定', color:'#8b9dc3', anim:'anim-sway' },
  sweet:    { face:'(♡°▽°♡)',   label:'甜蜜', color:'#ff85a2', anim:'anim-heart' },
  cool:     { face:'(￣^￣)ゞ',  label:'冷酷', color:'#6366f1', anim:'anim-coolnod' },
  sleepy:   { face:'(-_-) zZZ', label:'犯困', color:'#9ca3af', anim:'anim-snooze' },
  bored:    { face:'(ーー゛)',    label:'无聊', color:'#9aa0b0', anim:'anim-sway' },
  silly:    { face:'(¬‿¬)',     label:'搞怪', color:'#f472b6', anim:'anim-wobble' },
};

// 兼容拆分后的老 API：现在统一用颜文字风格，label 参数只用于保持 API 签名一致
export const PIXEL_MOODS = MOODS;
export const KIT_MOODS   = MOODS;

/** 取心情对象：统一颜文字，label 参数保留兼容不做区分 */
export function getMood(label, mood) {
  return MOODS[mood] || MOODS.happy;
}

/** 快捷方式：只取表情 face 字符串 */
export function getFace(label, mood) {
  return getMood(label, mood).face;
}

/** 从 AI 回复文本中检测情绪 */
export function detectMood(text) {
  const t = text || '';
  // ===== 优先：颜文字识别（Kit 只用颜文字，不用 emoji）=====
  // 开心/治愈/甜蜜
  if (/\(◕‿◕\)|ヽ\(✧Д✧\)|ヽ\(・∀・\)ノ|♡°▽°♡|〃ω〃|\(｡･ω･｡\)/.test(t)) return 'happy';
  if (/\(•́ω•̀\)|ฅ•́ω•̀ฅ|\(♡°▽°♡\)|温柔|暖|么么|抱抱/.test(t)) return 'sweet';
  if (/\(｡•́︿•̀｡\)|摸摸|别难过|心疼|安心|放心|治愈/.test(t)) return 'healing';
  // 得意/淡定/冷酷/犯困
  if (/\(￣▽￣\)|\(￣︶￣\)|厉害|牛|棒|完美|优秀|太强|服了|根据|资料|查到|来源/.test(t)) return 'proud';
  if (/\(￣ω￣\)|\(。・ω・。\)|随便|无所谓|行吧|哦|好吧|无聊|算了|淡定/.test(t)) return 'chill';
  if (/\(￣^￣\)ゞ|就这|不屑|哼\b|拽|酷|\(¬‿¬\)/.test(t)) return 'cool';
  if (/\(-_-\)|zzz|疲惫|累|困|睡|晚安|\(=_=\)/.test(t)) return 'sleepy';
  // 思考/疑惑/惊讶/担心
  if (/\(。-ω-\)|\(・_・\)|嗯|emmm|让我想想|稍等|考虑|琢磨|分析|等一下/.test(t)) return 'thinking';
  if (/\(・_・;\)|疑惑|迷惑|奇怪|不懂|不明白|为啥|为什么|搞不懂|\?\s*$/.test(t)) return 'confused';
  if (/\(⊙▽⊙\)|哦！|哇|天哪|居然|震惊|不可思议|啥|怎么可能|\(☉_☉\)/.test(t)) return 'surprised';
  if (/\(・_・;\)ゞ|对不起|抱歉|担心|万一|小心|危险|冒险|\(>﹏<\)/.test(t)) return 'worried';
  // 兴奋/生气/难过/掀桌
  if (/✧\(>o<\)✧|哇塞|哈哈|嘿嘿|嘻嘻|笑死|hh\b|ww\b|太棒|乐了|搞一下|我来|帮你|试试看|马上/.test(t)) return 'excited';
  if (/\(｀へ´\)|▼皿▼|\(；´Д｀\)|生气|可恶|烦|讨厌|滚|过分|愤怒/.test(t)) return 'angry';
  if (/\(╯[^\n]*╯|┻━┻|掀桌|你行你上/.test(t)) return 'angry';
  if (/\(´；ω；`\)|呜呜|难过|伤心|哭了|泪|遗憾|心酸|\(;´༎ຶД༎ຶ`\)/.test(t)) return 'sad';
  // 害羞（最后检查，避免误匹配）
  if (/\(〃ω〃\)|⁄\(⁄ ⁄•⁄ω⁄•⁄ ⁄\)⁄|害羞|不好意思|脸红|难为情/.test(t)) return 'shy';

  // ===== 中文/emoji 关键词（Pixel 用）=====
  if (/哈哈|嘿嘿|嘻嘻|笑死|hh|ww|😂|🤣|太好|好笑|逗|乐了/.test(t)) return 'excited';
  if (/呜呜|难过|伤心|哭了|😢|😭|遗憾|心酸|泪/.test(t)) return 'sad';
  if (/生气|可恶|哼|😠|😡|愤怒|过分|烦|讨厌|滚/.test(t)) return 'angry';
  if (/啊|哇|天哪|居然|震惊|😱|😲|不可思议|啥|怎么可能/.test(t)) return 'surprised';
  if (/嗯|emmm|让我想想|等等|稍等|正在|考虑|分析|琢磨/.test(t)) return 'thinking';
  if (/\?$|为啥|为什么|搞不懂|迷惑|奇怪|不懂|不明白/.test(t)) return 'confused';
  if (/爱你|喜欢|么么|亲亲|❤|💕|♡|甜蜜|温柔|暖/.test(t)) return 'sweet';
  if (/放心吧|摸摸|乖|心疼|别难过|没关系|抱抱|安心/.test(t)) return 'healing';
  if (/厉害|牛|棒|完美|💪|👍|优秀|太强|聪明|服了/.test(t)) return 'proud';
  if (/抱歉|对不起|担心|万一|小心|危险|冒险/.test(t)) return 'worried';
  if (/随便|哦|好吧|行吧|无聊|无所谓|随便你|算了/.test(t)) return 'chill';
  if (/困|睡了|慢着|累了|晚安|zzz|疲惫/.test(t)) return 'sleepy';
  if (/哼|酷|拽|😎|不屑|就这|菜/.test(t)) return 'cool';
  if (/害羞|不好意思|⁄|羞|脸红|难为情/.test(t)) return 'shy';
  if (/天气|温度|°C|℃|湿度|风速|晴天|多云|下雨|下雪/.test(t)) return 'healing';
  if (/搜索|查到|找到|根据|来源|据报道|资料显示/.test(t)) return 'proud';
  if (/可以|帮你|试试|让我|我来|马上|试试看|搞一下/.test(t)) return 'excited';
  // 短文本用长度确定性映射（比随机好，同一长度同一表情）
  if (t.length <= 8) {
    const shorts = ['happy','thinking','chill','cool','proud','healing'];
    return shorts[t.length % shorts.length];
  }
  return 'happy';
}
