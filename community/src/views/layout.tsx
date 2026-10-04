import type { Child } from 'hono/jsx';
import { asset } from '../lib/assets.js';
export interface Viewer {id: number; username:string; avatar_url:string|null; role:string; must_change_password:number}
export interface PageProps { title: string; children: Child; theme?: string; embed?: boolean; csrf?:string; user?:Viewer|null; path?:string; editor?:boolean; notice?:string }
export function Icon({name}:{name:string}) { return <svg class="icon" width="18" height="18" aria-hidden="true"><use href={`/assets/icons.svg#${name}`}/></svg>; }
export function Csrf({value}:{value?:string}) {return <input type="hidden" name="csrf" value={value}/>;}
export function Layout(p:PageProps) {
  return <html lang="zh-CN" data-theme={p.theme} data-embed={p.embed?'1':'0'}><head>
    <meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
    <title>{p.title} · BuildMe 社区</title><meta name="description" content="分享发现，讨论 Agent，记录每一次动手的经验。"/>
    <link rel="stylesheet" href={asset('site.css')}/><script src={asset('site.js')} defer/>
    {p.editor && <script src={asset('editor.js')} defer/>}
  </head><body class={p.embed?'is-embed':''}><div class="shell">
    <header class="site-header"><div class="header-inner"><a href="/latest" class="brand"><span class="brand-mark"><Icon name="cube"/></span>BuildMe <span class="brand-subtitle">社区</span></a>
      <nav class="nav" aria-label="主导航"><span aria-disabled="true" title="C4 开放">热门<small>即将开放</small></span><a href="/latest" aria-current={p.path==='/latest'?'page':undefined}>最新</a><span aria-disabled="true" title="C4 开放">精华</span><span aria-disabled="true" title="C5 开放">作品墙</span></nav>
      <div class="header-actions"><form method="get" action={p.path??'/latest'} class="inline-form"><Csrf value={p.csrf}/><input name="returnTo" type="hidden" value={p.path??'/latest'}/><select name="theme" aria-label="主题"><option value="system" selected={!p.theme}>跟随系统</option><option value="light" selected={p.theme==='light'}>浅色</option><option value="dark" selected={p.theme==='dark'}>深色</option></select><button class="button" type="submit">切换</button></form>
      <span class="download-link muted">下载即将开放</span>{p.user?<><a href="/new" class="button primary">写长文</a><a href="/settings" class="account-link">{p.user.username}</a></>:<a href="/login" class="button primary">登录 / 注册</a>}</div>
    </div></header><main class="page">{p.notice&&<p class="notice" role="status">{p.notice}</p>}{p.children}</main>
    <footer class="site-footer"><span>BuildMe 社区 · 让每一次尝试，都有回响</span><a href="/about">关于与规则</a></footer></div></body></html>;
}
export function Empty({title,children}:{title:string;children?:Child}) {return <div class="empty"><Icon name="chat"/><h2>{title}</h2><p>{children}</p></div>;}
export function Avatar({user}:{user:{username:string;avatar_url?:string|null}}) {const tone=[...user.username].reduce((n,c)=>n+c.codePointAt(0)!,0)%6;return user.avatar_url?<img class="avatar" src={user.avatar_url} alt="" width="32" height="32"/>:<span class={`avatar tone-${tone}`} aria-hidden="true">{[...user.username][0]}</span>;}
