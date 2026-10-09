(() => {
  const markdown = window.markdownit({ html: false, breaks: true });
  markdown.validateLink = url => /^https?:\/\//i.test(url);
  markdown.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
    tokens[index].attrSet("target", "_blank");
    tokens[index].attrSet("rel", "noopener noreferrer");
    return renderer.renderToken(tokens, index, options);
  };
  markdown.renderer.rules.image = (tokens, index) => markdown.utils.escapeHtml(tokens[index].content);
  markdown.renderer.rules.table_open = () => '<div class="markdown-table" tabindex="0" role="region" aria-label="表格"><table>\n';
  markdown.renderer.rules.table_close = () => "</table></div>\n";
  for (const type of ["th_open", "td_open"]) markdown.renderer.rules[type] = (tokens, index, options, env, renderer) => {
    const token = tokens[index], alignment = token.attrGet("style");
    if (alignment) {
      token.attrs = token.attrs.filter(([name]) => name !== "style");
      token.attrSet("class", `markdown-align-${alignment.replace("text-align:", "")}`);
    }
    return renderer.renderToken(tokens, index, options);
  };
  const sources = new WeakMap();
  window.renderMarkdown = (element, text) => {
    if (sources.get(element) === text) return;
    sources.set(element, text);
    element.classList.add("markdown-body");
    element.innerHTML = markdown.render(text);
  };
})();
