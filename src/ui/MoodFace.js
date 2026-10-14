/**
 * MoodFace - 网易云风格点阵表情组件
 * 在AI消息旁显示情绪小圆脸，根据回复内容自动切换表情
 */

// 情绪定义：8种常用情绪 + 渐变色
const MOODS = {
  happy:   { label: '开心', gradient: ['#FFD93D','#FF8C42'] },
  healing: { label: '治愈', gradient: ['#A8E6CF','#56C596'] },
  sweet:   { label: '甜蜜', gradient: ['#FFB6C1','#FF69B4'] },
  thinking:{ label: '思考', gradient: ['#B8C6DB','#8E9EAB'] },
  sad:     { label: '悲伤', gradient: ['#7EB8DA','#4A90D9'] },
  angry:   { label: '生气', gradient: ['#FF6B6B','#EE5A24'] },
  surprise:{ label: '惊讶', gradient: ['#FDCB6E','#F39C12'] },
  default: { label: '默认', gradient: ['#B8C6DB','#9FA4C4'] },
};

// 点阵面定义：9列 x 9行，1=亮，0=暗
// 每种情绪有不同的点阵图案
const FACE_DOTS = {
  // 开心：弯弯眼 + 微笑嘴
  happy: [
    0,0,0,1,1,1,0,0,0,
    0,0,1,0,0,0,1,0,0,
    0,1,0,0,0,0,0,1,0,
    1,0,0,1,0,1,0,0,1,
    1,0,1,0,0,0,1,0,1,
    1,0,0,1,0,1,0,0,1,
    0,1,0,0,1,0,0,1,0,
    0,0,1,1,0,1,1,0,0,
    0,0,0,1,1,1,0,0,0,
  ],
  // 治愈：半闭眼 + 温柔微笑
  healing: [
    0,0,0,1,1,1,0,0,0,
    0,0,1,0,0,0,1,0,0,
    0,1,0,0,0,0,0,1,0,
    1,0,1,1,0,1,1,0,1,
    1,1,0,0,0,0,0,1,1,
    1,0,0,0,0,0,0,0,1,
    0,1,0,0,1,0,0,1,0,
    0,0,1,1,0,1,1,0,0,
    0,0,0,1,1,1,0,0,0,
  ],
  // 甜蜜：爱心眼 + 小嘴
  sweet: [
    0,0,0,1,1,1,0,0,0,
    0,0,1,0,0,0,1,0,0,
    0,1,1,0,1,0,1,1,0,
    1,1,0,0,0,0,0,1,1,
    1,0,0,0,0,0,0,0,1,
    0,1,0,0,0,0,0,1,0,
    0,0,1,0,1,0,1,0,0,
    0,0,0,1,0,1,0,0,0,
    0,0,0,0,1,0,0,0,0,
  ],
  // 思考：看向一侧 + 嘴偏
  thinking: [
    0,0,0,1,1,1,0,0,0,
    0,0,1,0,0,0,1,0,0,
    0,1,0,0,0,0,0,1,0,
    1,0,1,0,1,0,0,0,1,
    1,0,0,0,0,0,1,0,1,
    1,0,0,0,0,0,0,0,1,
    0,1,0,0,0,1,0,1,0,
    0,0,1,0,1,0,1,0,0,
    0,0,0,1,1,1,0,0,0,
  ],
  // 悲伤：泪眼 + 下弯嘴
  sad: [
    0,0,0,1,1,1,0,0,0,
    0,0,1,0,0,0,1,0,0,
    0,1,0,0,0,0,0,1,0,
    1,0,0,1,0,1,0,0,1,
    1,0,1,0,0,0,1,0,1,
    1,0,0,1,0,1,0,0,1,
    0,1,0,0,0,0,0,1,0,
    0,0,1,1,0,1,1,0,0,
    0,0,0,1,1,1,0,0,0,
  ],
  // 生气：倒八字眉 + 嘴紧闭
  angry: [
    0,0,0,1,1,1,0,0,0,
    0,0,1,0,0,0,1,0,0,
    1,0,0,0,0,0,0,0,1,
    1,0,1,0,1,0,1,0,1,
    1,0,0,1,0,1,0,0,1,
    1,0,0,0,0,0,0,0,1,
    0,1,1,1,1,1,1,1,0,
    0,0,1,0,0,0,1,0,0,
    0,0,0,1,1,1,0,0,0,
  ],
  // 惊讶：大圆眼 + O嘴
  surprise: [
    0,0,0,1,1,1,0,0,0,
    0,0,1,0,0,0,1,0,0,
    0,1,0,0,0,0,0,1,0,
    1,0,1,1,0,1,1,0,1,
    1,0,1,0,0,0,1,0,1,
    1,0,1,1,0,1,1,0,1,
    0,1,0,0,1,0,0,1,0,
    0,0,1,0,1,0,1,0,0,
    0,0,0,1,0,1,0,0,0,
  ],
  // 默认：中性脸 (｡･ω･｡)
  default: [
    0,0,0,1,1,1,0,0,0,
    0,0,1,0,0,0,1,0,0,
    0,1,0,0,0,0,0,1,0,
    1,0,0,1,0,1,0,0,1,
    1,0,0,0,0,0,0,0,1,
    1,0,0,0,1,0,0,0,1,
    0,1,0,1,0,1,0,1,0,
    0,0,1,0,0,0,1,0,0,
    0,0,0,1,1,1,0,0,0,
  ],
};

// 情绪关键词检测
const MOOD_RULES = [
  { mood: 'happy',    words: /开心|高兴|快乐|哈哈|嘻嘻|太好了|好耶|棒|厉害|不错|很好|✨|🎉|😄|😂|🥳|太棒|超级好|很棒|赞/ },
  { mood: 'healing',  words: /治愈|温暖|安心|舒服|放松|平静|宁静|温馨|柔和|守护|陪伴|🌸|🌿|💚|🍃|舒服|治愈/ },
  { mood: 'sweet',    words: /甜蜜|可爱|喜欢|萌|甜|心动|浪漫|💕|💗|💖|❤️|么么|贴贴|抱抱/ },
  { mood: 'thinking', words: /让我想|嗯|思考|分析|看看|琢磨|研究|梳理|整理|考虑|🤔|思考|看看|嗯../ },
  { mood: 'sad',      words: /难过|悲伤|可惜|遗憾|😢|呜|哭|心酸|心痛|悲伤|忧伤|emo|低落/ },
  { mood: 'angry',    words: /哼|生气|讨厌|烦|气死|愤怒|可恶|😠|💢|才不是|才不要/ },
  { mood: 'surprise', words: /哇|天哪|震惊|没想到|不会吧|真的吗|惊讶|意外|😮|😲|啥|什么|!?/ },
];

/**
 * 从文本检测情绪
 */
export function detectMood(text) {
  if (!text) return 'default';
  for (const rule of MOOD_RULES) {
    if (rule.words.test(text)) return rule.mood;
  }
  return 'default';
}

/**
 * 创建点阵表情 SVG
 * @param {string} mood - 情绪类型
 * @param {number} size - SVG尺寸（像素）
 * @returns {string} SVG HTML
 */
export function createMoodFaceSVG(mood = 'default', size = 36) {
  const m = MOODS[mood] || MOODS.default;
  const dots = FACE_DOTS[mood] || FACE_DOTS.default;
  const cols = 9, rows = 9;
  const dotR = 1.3;       // 亮点半径
  const dimR = 0.6;       // 暗点半径
  const gap = 3.4;        // 点间距
  const pad = 3;          // 内边距
  const svgW = pad * 2 + (cols - 1) * gap;
  const svgH = pad * 2 + (rows - 1) * gap;

  let dotsHtml = '';
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      const lit = dots[idx];
      const cx = pad + c * gap;
      const cy = pad + r * gap;
      if (lit) {
        dotsHtml += `<circle cx="${cx}" cy="${cy}" r="${dotR}" fill="url(#glow-${mood})" opacity="1"/>`;
      } else {
        dotsHtml += `<circle cx="${cx}" cy="${cy}" r="${dimR}" fill="rgba(255,255,255,0.15)" opacity="0.5"/>`;
      }
    }
  }

  return `<svg class="mood-face" width="${size}" height="${size}" viewBox="0 0 ${svgW} ${svgH}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="grad-${mood}" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="${m.gradient[0]}" stop-opacity="0.2"/>
        <stop offset="100%" stop-color="${m.gradient[1]}" stop-opacity="0.05"/>
      </radialGradient>
      <filter id="glow-filter-${mood}">
        <feGaussianBlur stdDeviation="0.8" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
      <linearGradient id="glow-${mood}" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${m.gradient[0]}"/>
        <stop offset="100%" stop-color="${m.gradient[1]}"/>
      </linearGradient>
    </defs>
    <rect rx="4" ry="4" width="${svgW}" height="${svgH}" fill="url(#grad-${mood})"/>
    <g filter="url(#glow-filter-${mood})">${dotsHtml}</g>
  </svg>`;
}

/**
 * 创建带表情的消息头部（meta + face）
 */
export function createMoodMeta(label, mood) {
  const face = createMoodFaceSVG(mood, 28);
  return `<span class="mood-meta-inner">${face}<span class="mood-label">${label}</span></span>`;
}
