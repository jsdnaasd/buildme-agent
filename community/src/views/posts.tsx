import type { Context } from "hono";
import type { Env } from "../types.js";
import { Layout, Csrf, Avatar, Icon, Empty } from "./layout.js";
import { pageProps, Field, Errors } from "./forms.js";
import {
  categories,
  tags,
  blankPost,
  type Post,
  type PostInput,
} from "../lib/posts.js";
import type { Heading } from "../lib/markdown.js";
import type { Reply } from "../lib/interactions.js";
import { ReplyCard, ReplyForm, Reactions, Bookmark } from "./interactions.js";
import type { FormError } from "../lib/validation.js";
export function relativeTime(at: number, now: number) {
  const mins = Math.max(0, Math.floor((now - at) / 60000));
  return mins < 1
    ? "刚刚"
    : mins < 60
      ? `${mins} 分钟前`
      : mins < 1440
        ? `${Math.floor(mins / 60)} 小时前`
        : `${Math.floor(mins / 1440)} 天前`;
}
export function Vote({ c, post }: { c: Context<Env>; post: Post }) {
  const user = c.get("user");
  return (
    <form
      class={`vote ${post.voted ? "on" : ""}`}
      data-interaction="vote"
      method="post"
      action={`/p/${post.id}/vote`}
    >
      <Csrf value={c.get("csrf")} />
      <input type="hidden" name="active" value={post.voted ? "0" : "1"} />
      {user ? (
        <button
          type="submit"
          aria-label={post.voted ? "取消点赞" : "点赞"}
          aria-pressed={!!post.voted}
          disabled={user.id === post.author_id}
        >
          <Icon name="up" />
          <b data-count>{post.vote_count}</b>
        </button>
      ) : (
        <a href="/login" aria-label="登录后点赞">
          <Icon name="up" />
          <b data-count>{post.vote_count}</b>
        </a>
      )}
    </form>
  );
}
export function LinkCard({ post }: { post: Post }) {
  return post.link ? (
    <a
      class="link-card"
      href={`/go/${post.id}`}
      target="_blank"
      rel="nofollow noopener ugc"
    >
      {post.link_thumbnail && (
        <img
          src={post.link_thumbnail}
          alt=""
          width="104"
          height="65"
          loading="lazy"
        />
      )}
      <span class="source-badge">{post.link_source}</span>
      <span>
        <strong>{post.link_title || post.title}</strong>
        <small>{new URL(post.link).hostname}</small>
      </span>
    </a>
  ) : null;
}
export function PostCard({ c, post }: { c: Context<Env>; post: Post }) {
  return (
    <article class="post-card" id={`post-${post.id}`}>
      <Vote c={c} post={post} />
      <div class="post-main">
        <div class="post-meta">
          <Avatar user={post} />
          <a href={`/u/${post.author_id}`}>{post.username}</a>
          <time dateTime={new Date(post.created_at).toISOString()}>
            {relativeTime(post.created_at, c.get("now"))}
          </time>
          <span class="category">{post.category_name}</span>
          {post.status === "pending" && (
            <span class="status-badge">审核中</span>
          )}
        </div>
        <h2 class="post-title">
          <a href={`/p/${post.id}`}>{post.title}</a>
        </h2>
        <p class="excerpt">{post.excerpt}</p>
        <LinkCard post={post} />
        <Reactions c={c} kind="post" id={post.id}/>
        <div class="post-actions">
          <a href={`/p/${post.id}#replies`}>
            <Icon name="chat" />
            {post.reply_count} 条回复
          </a>
          <span>{post.views} 次浏览</span>
          {post.tags_text
            .split("\n")
            .filter(Boolean)
            .map((t) => (
              <span class="tag">#{t}</span>
            ))}
        </div>
      </div>
    </article>
  );
}
function PostFields({
  c,
  values,
  error,
  quick = false,
}: {
  c: Context<Env>;
  values: PostInput;
  error?: FormError;
  quick?: boolean;
}) {
  const allTags = tags(c.get("db"));
  return (
    <>
      <Field
        label="链接（可选）"
        name="link"
        value={values.link}
        error={error?.fields.link}
      />
      <div id="link-status" role="status" />
      <Field
        label="标题"
        name="title"
        value={values.title}
        error={error?.fields.title}
        required
      />
      {quick ? (
        <input type="hidden" name="category" value="1" />
      ) : (
        <Field label="板块" name="category" error={error?.fields.category}>
          <select name="category" required>
            <option value="">选择板块</option>
            {categories(c.get("db")).map((cat) => (
              <option
                value={cat.id}
                selected={String(cat.id) === values.category}
              >
                {cat.name} — {cat.description}
              </option>
            ))}
          </select>
        </Field>
      )}
      <fieldset class="field">
        <legend>标签 · 最多 5 个</legend>
        <div class="tags">
          {allTags.map((t) => (
            <label class="tag">
              <input
                type="checkbox"
                name="tags"
                value={t.id}
                checked={values.tags.includes(String(t.id))}
              />
              {t.name}
            </label>
          ))}
        </div>
        {error?.fields.tags && <p class="field-error">{error.fields.tags}</p>}
      </fieldset>
      <label class="field-help">
        <input
          type="checkbox"
          name="confirmDuplicate"
          value="1"
          checked={values.confirmDuplicate === "1"}
        />
        如果这个链接最近已被分享，仍然继续发布
      </label>
    </>
  );
}
export function Editor({
  c,
  values = blankPost(),
  error,
  post,
  preview,
  notice,
}: {
  c: Context<Env>;
  values?: PostInput;
  error?: FormError;
  post?: Post;
  preview?: { html: string; toc: Heading[] };
  notice?: string;
}) {
  const user = c.get("user")!;
  const editorId = post
    ? `post-${post.id}`
    : values.draftId
      ? `draft-${values.draftId}`
      : "new";
  return (
    <Layout
      {...pageProps(c, post ? "编辑帖子" : "写下你的发现")}
      editor
      notice={notice}
    >
      <div class="page-heading">
        <div>
          <p class="eyebrow">SHARE WHAT YOU LEARN</p>
          <h1>{post ? "编辑帖子" : "写下你的发现"}</h1>
          <p class="muted">一个链接、一篇笔记，或一个值得一起讨论的问题。</p>
        </div>
        <a href="/drafts">我的草稿</a>
      </div>
      <Errors error={error} />
      <form
        class="form"
        method="post"
        action={post ? `/p/${post.id}/edit` : "/new"}
        enctype="multipart/form-data"
        data-editor
        data-editor-id={editorId}
        data-user-id={user.id}
      >
        <Csrf value={c.get("csrf")} />
        <input type="hidden" name="draftId" value={values.draftId} />
        <input type="hidden" name="editorId" value={editorId} />
        <PostFields c={c} values={values} error={error} />
        <div class="editor-tabs" role="tablist" aria-label="编辑与预览">
          <button
            type="button"
            data-editor-tab="edit"
            role="tab"
            aria-selected="true"
          >
            编辑
          </button>
          <button
            type="button"
            data-editor-tab="preview"
            role="tab"
            aria-selected="false"
          >
            预览
          </button>
        </div>
        <div class="editor-grid">
          <div class="editor-pane">
            <div class="toolbar" aria-label="Markdown 工具栏">
              {[
                ["heading", "标题"],
                ["bold", "加粗"],
                ["italic", "斜体"],
                ["quote", "引用"],
                ["code", "代码"],
                ["codeblock", "代码块"],
                ["link", "链接"],
                ["list", "列表"],
                ["ordered", "有序列表"],
                ["image", "图片"],
                ["emoji", "表情"],
              ].map(([key, label]) => (
                <button type="button" data-markdown={key} title={label}>
                  {label}
                </button>
              ))}
            </div>
            <label class="field">
              <span>正文 · Markdown</span>
              <textarea
                name="body"
                rows={20}
                placeholder="从你想分享的第一句话开始…"
              >
                {values.body}
              </textarea>
            </label>
            {error?.fields.body && (
              <p class="field-error">{error.fields.body}</p>
            )}
          </div>
          <div class="preview-pane">
            <div class="preview-heading">预览</div>
            <nav id="preview-toc" class="toc" aria-label="预览目录">
              {preview?.toc.map((h) => (
                <a class={`level-${h.level}`} href={`#${h.id}`}>
                  {h.text}
                </a>
              ))}
            </nav>
            <div
              id="editor-preview"
              class="prose"
              dangerouslySetInnerHTML={{
                __html: preview?.html ?? "<p>内容会在这里预览。</p>",
              }}
            />
          </div>
        </div>
        <Field
          label="插入图片"
          name="image"
          help="JPG、PNG、WebP ≤ 8MB；GIF ≤ 4MB。也可以粘贴或拖入图片。"
        >
          <input
            name="image"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            data-image-input
          />
        </Field>
        <noscript>
          <p>上传图片后会回到编辑页，正文将插入图片语法。</p>
          <button class="button" type="submit" formaction="/images">
            上传并插入图片
          </button>
        </noscript>
        <div id="editor-status" role="status" />
        <div class="form-actions">
          <button class="button primary" type="submit">
            {post ? "保存修改" : "发布"}
          </button>
          <button
            class="button"
            type="submit"
            formaction="/preview"
            formnovalidate
          >
            预览全文
          </button>
          {!post && (
            <button
              class="button"
              type="submit"
              formaction="/drafts"
              formnovalidate
            >
              保存草稿
            </button>
          )}
          <a href="/latest">返回社区</a>
        </div>
      </form>
    </Layout>
  );
}
export function Latest({
  c,
  posts,
  page,
  sort,
  category,
}: {
  c: Context<Env>;
  posts: Post[];
  page: number;
  sort: string;
  category: string;
}) {
  const user = c.get("user"),
    db = c.get("db");
  const stats = db
    .prepare(
      "SELECT (SELECT COUNT(*) FROM users WHERE banned=0) users,(SELECT COUNT(*) FROM posts p JOIN users u ON u.id=p.author_id WHERE p.status='public' AND u.banned=0) posts",
    )
    .get() as { users: number; posts: number };
  return (
    <Layout {...pageProps(c, "最新")} editor={!!user}>
      <div class="page-heading">
        <div>
          <p class="eyebrow">BUILD TOGETHER</p>
          <h1>每一次动手，都值得分享。</h1>
          <p class="muted">好的链接、踩过的坑，还有你的下一次灵感。</p>
        </div>
        <a class="button" href="/new">
          写长文 <span aria-hidden="true">↗</span>
        </a>
      </div>
      <div class="layout">
        <section class="feed">
          {user ? (
            <details class="panel quick-share">
              <summary>贴一个链接，再说两句为什么推荐</summary>
              <form
                class="form"
                method="post"
                action="/new"
                data-quick-share
                data-editor-id="new"
                data-user-id={user.id}
              >
                <Csrf value={c.get("csrf")} />
                <input type="hidden" name="editorId" value="new" />
                <PostFields c={c} values={blankPost()} quick />
                <Field label="几句话" name="body">
                  <textarea name="body" rows={3} />
                </Field>
                <div id="editor-status" role="status" />
                <button class="button primary" type="submit">
                  发布
                </button>
                <a href="/new">使用完整编辑器</a>
              </form>
            </details>
          ) : (
            <div class="panel quick-share">
              <p>分享你的发现，让灵感继续生长。</p>
              <a class="button primary" href="/login">
                登录后分享
              </a>
            </div>
          )}
          <div class="feed-toolbar">
            <div class="feed-tabs">
              <a
                href="/latest"
                aria-current={sort !== "created" ? "page" : undefined}
              >
                最近活跃
              </a>
              <a
                href="/latest?sort=created"
                aria-current={sort === "created" ? "page" : undefined}
              >
                最新发布
              </a>
            </div>
            <span class="muted">每页 30 条</span>
          </div>
          <div id="post-list" class="feed">
            {posts.length ? (
              posts.map((post) => <PostCard c={c} post={post} />)
            ) : (
              <Empty title="从第一个发现开始">
                这里还没有帖子。分享一条链接，或写下你的学习笔记。
              </Empty>
            )}
          </div>
          <nav class="form-actions" aria-label="帖子分页">
            {page > 1 && (
              <a
                class="button"
                href={`/latest?page=${page - 1}&sort=${sort}&category=${category}`}
              >
                上一页
              </a>
            )}
            {posts.length === 30 && (
              <a
                class="button"
                href={`/latest?page=${page + 1}&sort=${sort}&category=${category}`}
              >
                下一页
              </a>
            )}
          </nav>
        </section>
        <aside class="sidebar">
          <section class="panel">
            <h2>一起聊什么</h2>
            <ul class="category-list">
              <li>
                <a href="/latest">全部板块</a>
              </li>
              {categories(db).map((cat) => (
                <li>
                  <a
                    href={`/latest?category=${cat.id}`}
                    aria-current={
                      category === String(cat.id) ? "page" : undefined
                    }
                  >
                    <span class={`category-dot ${cat.slug}`} />
                    <span>
                      {cat.name}
                      <small>{cat.description}</small>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
          <section class="panel">
            <h2>大家关注</h2>
            <div class="tags">
              {tags(db).map((t) => (
                <span class="tag">#{t.name}</span>
              ))}
            </div>
            {user && (
              <details>
                <summary>申请新标签</summary>
                <form method="post" action="/tags/request">
                  <Csrf value={c.get("csrf")} />
                  <Field label="标签名" name="name" required />
                  <button class="button">提交申请</button>
                </form>
              </details>
            )}
          </section>
          <section class="panel">
            <h2>社区正在生长</h2>
            <p>
              <strong>{stats.users}</strong> 位成员 ·{" "}
              <strong>{stats.posts}</strong> 篇帖子
            </p>
            <p class="muted">
              分享真实的经验，提出具体的问题。每一次尝试都能帮助别人少走一步弯路。
            </p>
          </section>
          <section class="panel">
            <h2>下一块积木</h2>
            <p class="muted">作品墙、热门榜与搜索将在后续开放。</p>
          </section>
        </aside>
      </div>
    </Layout>
  );
}
export function Detail({
  c,
  post,
  replies,
  page,
  total,
  clearDraft,
  max,
}: {
  c: Context<Env>;
  post: Post;
  replies: Reply[];
  page: number;
  total: number;
  max: number;
  clearDraft?: string;
}) {
  const user = c.get("user"),
    toc = JSON.parse(post.toc) as Heading[];
  return (
    <Layout {...pageProps(c, post.title)}>
      {clearDraft && (
        <span hidden data-clear-draft={clearDraft} data-user-id={user!.id} />
      )}
      <a href="/latest" class="muted">
        ← 返回社区
      </a>
      <article class="panel">
        <header class="detail-header">
          <div class="post-meta">
            <Avatar user={post} />
            <a href={`/u/${post.author_id}`}>{post.username}</a>
            <span class="category">{post.category_name}</span>
            <time>{relativeTime(post.created_at, c.get("now"))}</time>
            {post.updated_at && (
              <span>
                编辑于{" "}
                {new Date(post.updated_at).toLocaleString("zh-CN", {
                  timeZone: "Asia/Shanghai",
                })}
              </span>
            )}
          </div>
          <h1>{post.title}</h1>
          {post.status === "pending" && (
            <p class="notice">审核中：管理员通过后会向所有人公开。</p>
          )}
        </header>
        <LinkCard post={post} />
        <div class="prose-layout">
          <div class="prose" dangerouslySetInnerHTML={{ __html: post.html }} />
          {toc.length > 0 && (
            <nav class="toc" aria-label="文章目录">
              <strong>本文目录</strong>
              {toc.map((h) => (
                <a class={`level-${h.level}`} href={`#${h.id}`}>
                  {h.text}
                </a>
              ))}
            </nav>
          )}
        </div>
        <div class="post-actions">
          <Vote c={c} post={post} />
          <Bookmark c={c} post={post}/>
          <span>{post.views} 次浏览</span>
          {user && (user.id === post.author_id || user.role === "admin") && (
            <>
              <a href={`/p/${post.id}/edit`}>编辑</a>
              <form method="post" action={`/p/${post.id}/delete`}>
                <Csrf value={c.get("csrf")} />
                <button class="button" type="submit">
                  删除帖子
                </button>
              </form>
            </>
          )}
          {user?.role === "admin" && (
            <a href={`/admin/posts/${post.id}/history`}>编辑历史</a>
          )}
        </div>
        <Reactions c={c} kind="post" id={post.id}/>
      </article>
      <section id="replies" class="reply-list" data-discussion data-post-id={post.id} data-max-floor={max}>
        <div class="page-heading">
          <h2>{total} 条回复</h2>
        </div>
        <p id="discussion-status" role="status"/>
        <button id="reply-quote" class="button" type="button" hidden>引用</button>
        {max>0 && <div class="floor-progress"><label>楼层 <span data-floor-position>{(page-1)*30+1} / {max}</span><input type="range" data-floor-slider min="1" max={max} value={(page-1)*30+1} aria-label="跳转楼层"/></label></div>}
        <div id="reply-pages">{replies.map(reply=><ReplyCard c={c} post={post} reply={reply}/>)}</div>
        <nav class="form-actions">
          {page > 1 && (
            <a href={`/p/${post.id}?page=${page - 1}#replies`}>上一页</a>
          )}
          {page * 30 < max && (
            <a data-more-replies href={`/p/${post.id}?page=${page + 1}#replies`}>下一页</a>
          )}
        </nav>
        {user ? (
          <ReplyForm c={c} post={post} parentFloor={/^\d+$/.test(c.req.query("replyTo")??'')?c.req.query("replyTo"):''}/>
        ) : (
          <p class="panel">
            <a href="/login">登录后参与讨论</a>
          </p>
        )}
      </section>
    </Layout>
  );
}
