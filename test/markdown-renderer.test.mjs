import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import vm from "node:vm";
import { parseHTML } from "linkedom";
import MarkdownIt from "markdown-it";
import { describe, expect, it } from "vitest";

const source = await readFile(new URL("../desktop/renderer/markdown.js", import.meta.url), "utf8");
function fixture() {
  const { window, document } = parseHTML("<html><body><article></article></body></html>");
  window.markdownit = MarkdownIt;
  vm.runInContext(source, vm.createContext({ window, document }));
  const article = document.querySelector("article");
  return { article, render: text => window.renderMarkdown(article, text) };
}

describe("chat Markdown", () => {
  it("renders the reported heading, emphasis, repository table, links, lists and literal code", () => {
    const { article, render } = fixture();
    render('## 装了什么\n\n**caveman** → `~/.claude/skills/caveman/`\n\n| 项 | 值 |\n|---|---|\n| 仓库 | [仓库](https://example.com/project) |\n| 文件 | `SKILL.md` + `LICENSE` |\n\n1. 第一项\n2. 第二项\n\n> 说明\n\n```sh\n# 原样保留\nprintf "**literal**"\n```');
    expect(article.querySelector("h2").textContent).toBe("装了什么");
    expect(article.querySelector("strong").textContent).toBe("caveman");
    expect(article.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(article.querySelector(".markdown-table").getAttribute("tabindex")).toBe("0");
    expect(article.querySelector("a").getAttribute("href")).toBe("https://example.com/project");
    expect(article.querySelector("a").getAttribute("rel")).toBe("noopener noreferrer");
    expect(article.querySelectorAll("ol li")).toHaveLength(2);
    expect(article.querySelector("blockquote").textContent.trim()).toBe("说明");
    expect(article.querySelector("pre code").textContent).toBe('# 原样保留\nprintf "**literal**"\n');
  });

  it("does not execute model HTML or create links to executable or local protocols", () => {
    const { article, render } = fixture();
    render('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[JS](javascript:alert(1)) [file](file:///etc/passwd) [data](data:text/html,payload) [app](custom:launch)\n\n![远程图片](https://example.com/tracker.png)');
    expect(article.querySelectorAll("script,img,iframe,a")).toHaveLength(0);
    expect(article.textContent).toContain("<script>alert(1)</script>");
    expect(article.textContent).toContain("远程图片");
  });

  it("reparses split Markdown tokens while preserving escapes and fenced code", () => {
    const { article, render } = fixture();
    render("## 标题\n\n**部");
    render("## 标题\n\n**部分完成**\n\n\\# 字面井号\n\n```md\n## 代码里的标题");
    expect(article.querySelector("strong").textContent).toBe("部分完成");
    expect(article.querySelectorAll("h2")).toHaveLength(1);
    expect(article.textContent).toContain("# 字面井号");
    expect(article.querySelector("pre code").textContent).toContain("## 代码里的标题");
  });

  it("keeps table alignment under the desktop policy that disallows inline styles", () => {
    const { article, render } = fixture();
    render("| 左 | 中 | 右 |\n|:---|:---:|---:|\n| 一 | 二 | 三 |");
    expect(article.querySelector("th.markdown-align-center").textContent).toBe("中");
    expect(article.querySelector("td.markdown-align-right").textContent).toBe("三");
    expect(article.querySelector("[style]")).toBeNull();
  });
});
