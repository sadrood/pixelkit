/**
 * MarkdownRenderer - 简易 Markdown → HTML 渲染器
 * 独立模块，纯函数，无副作用，可在任何地方使用
 */

/**
 * 处理单元格内行内格式（转义 + 粗体 + 行内代码）
 * @param {string} cell - 原始单元格文本
 * @returns {string} 转义后的 HTML
 */
function processCell(cell) {
  return cell
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

/**
 * 解析表格行（按 | 分割，trim）
 * @param {string} line
 * @returns {string[]}
 */
function parseRow(line) {
  return line.split('|').map(c => c.trim()).filter(c => c !== '' || line.startsWith('|'));
}

/**
 * 规范化行：补齐或截断到指定列数
 * @param {string[]} cells
 * @param {number} colCount
 * @returns {string[]}
 */
function normRow(cells, colCount) {
  const result = [...cells];
  while (result.length < colCount) result.push('');
  return result.slice(0, colCount);
}

/**
 * 解析 Markdown 表格块 → HTML <table> 元素，并用占位符替换原文
 * 返回 { text: 替换后的文本, tableHtmls: 占位符ID→HTML 的映射数组 }
 */
function renderTables(text) {
  const tableHtmls = [];
  const lines = text.split('\n');
  const result = [];
  let i = 0;

  while (i < lines.length) {
    if (lines[i].includes('|') && i + 2 < lines.length &&
        /^\|?[\s\-:|]+\|?$/.test(lines[i + 1]) &&
        lines[i + 2].includes('|')) {

      const tableLines = [];
      while (i < lines.length && lines[i].includes('|')) {
        tableLines.push(lines[i]);
        i++;
      }

      const headerCells = parseRow(tableLines[0]);
      const dataRows = tableLines.slice(2).map(parseRow);
      const colCount = headerCells.length;

      let tableHtml = '<table class="md-table"><thead><tr>';
      for (const cell of normRow(headerCells, colCount)) {
        tableHtml += `<th>${processCell(cell)}</th>`;
      }
      tableHtml += '</tr></thead><tbody>';
      for (const row of dataRows) {
        tableHtml += '<tr>';
        for (const cell of normRow(row, colCount)) {
          tableHtml += `<td>${processCell(cell)}</td>`;
        }
        tableHtml += '</tr>';
      }
      tableHtml += '</tbody></table>';

      const id = tableHtmls.length;
      tableHtmls.push(tableHtml);
      result.push(`\x00TABLE_${id}\x00`);
    } else {
      result.push(lines[i]);
      i++;
    }
  }

  return { text: result.join('\n'), tableHtmls };
}

/**
 * 将 Markdown 文本渲染为 HTML
 * @param {string} text - Markdown 原文
 * @param {Array<{url:string,title?:string}>} [sources] - 来源链接（用于 [来源N] 渲染）
 * @returns {string} HTML 字符串
 */
export function renderMarkdown(text, sources = null) {
  // 1. 先解析表格，用不可见占位符保护
  const { text: textWithoutTables, tableHtmls } = renderTables(text);

  // 2. HTML 转义
  let html = textWithoutTables
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // 3. 还原表格（已在 processCell 中做了转义，不受第2步影响）
  html = html.replace(/\x00TABLE_(\d+)\x00/g, (_, id) => tableHtmls[parseInt(id)] || '');

  // 4. 行内格式
  html = html
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');

  // 5. 标题
  html = html
    .replace(/^### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^## (.+)$/gm, '<h3>$1</h3>');

  // 6. 横线
  html = html.replace(/^---$/gm, '<hr>');

  // 7. 列表
  html = html
    .replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>')
    .replace(/^- (.+)$/gm, '<li>$1</li>');

  // 8. 换行
  html = html.replace(/\n\n/g, '<br><br>').replace(/\n/g, '<br>');

  // 9. 来源链接：[来源N] 或 [N]
  if (sources?.length) {
    html = html.replace(/\[来源(\d+)\]/g, (_, n) => {
      const src = sources[parseInt(n) - 1];
      return src ? `<a class="agent-source" href="${src.url}" target="_blank" title="${src.title || ''}">来源${n}</a>` : _;
    });
    html = html.replace(/\[(\d+)\]/g, (_, n) => {
      const src = sources[parseInt(n) - 1];
      return src ? `<a class="agent-source" href="${src.url}" target="_blank" title="${src.title || ''}">[${n}]</a>` : _;
    });
  }

  return html;
}
