window.__ModuleLoader__.load({id:'dsh-llm-api-perf-workbench',factory:(require)=>{
const React=require('react'),{useState,useEffect,useRef,useCallback}=React,h=React.createElement;
const CSS="/* Collapse the native conversation column when the panel asks for full width.\n   跨边界铁律：:has() 匹配 DOM 不匹配 hidden——宿主切日常模式是给 .dshWbBusiness\n   设 hidden 而非移除，链上必须带 :not([hidden]) 守卫，否则收起效果泄漏到日常模式\n   （压住聊天框）。状态类挂自己的 .pb-root，不写宿主 class。见 dsh-cross-boundary-css 技能。\n   收起用 flex-basis/width 归零 + opacity 0，而不是 display:none：原生对话区保持挂载，\n   避免宿主重挂时丢草稿/滚动位置；必须同时 overflow:hidden，否则内容仍占布局。 */\n.dshWbBody:has(> .dshWbBusiness:not([hidden]) .pb-root.pb-chat-collapsed) > .dshWbConversation{flex:0 0 0!important;width:0!important;min-width:0!important;overflow:hidden!important;opacity:0!important;pointer-events:none!important}\n.dshWbBody:has(> .dshWbBusiness:not([hidden]) .pb-root.pb-chat-collapsed) > .dshWbBusiness:not([hidden]){width:100%!important;max-width:100%!important;flex:1 1 100%!important}\n\n/* =========================================================\n   Design tokens — neutral ramp + one accent + semantic state.\n   Every downstream size references the 4/8 spacing scale and\n   the 12/13/15/16/20/24 type scale. No magic numbers.\n   ========================================================= */\n.pb-root{\n  --pb-bg:#f3f5f9;\n  --pb-card:#ffffff;\n  --pb-raised:#ffffff;\n  --pb-sunken:#eef1f7;\n  --pb-ink:#10151c;\n  --pb-muted:#55606e;\n  --pb-faint:#66717f;\n  --pb-line:#e2e7ef;\n  --pb-line-soft:#edf1f7;\n\n  --pb-accent:#3b4fd8;\n  --pb-accent-hover:#3042c8;\n  --pb-accent-ink:#ffffff;\n  --pb-tint:#eef1fd;\n  --pb-tint-strong:#e2e7fc;\n\n  --pb-ok:#0d6b45;\n  --pb-ok-tint:#e6f3ec;\n  --pb-warn:#8a5200;\n  --pb-warn-tint:#fbf0df;\n  --pb-bad:#a92d21;\n  --pb-bad-tint:#fbe9e6;\n\n  --pb-shadow-sm:0 1px 2px rgba(16,21,28,.05);\n  --pb-shadow-md:0 1px 2px rgba(16,21,28,.05),0 8px 24px rgba(16,21,28,.07);\n  --pb-shadow-pop:0 2px 4px rgba(16,21,28,.06),0 12px 32px rgba(16,21,28,.10);\n\n  --pb-r-card:12px;\n  --pb-r-control:8px;\n  --pb-r-pill:999px;\n\n  --pb-s1:4px;--pb-s2:8px;--pb-s3:12px;--pb-s4:16px;\n  --pb-s5:24px;--pb-s6:32px;--pb-s7:48px;--pb-s8:64px;\n\n  --pb-text-xs:12px;--pb-text-sm:13px;--pb-text-md:15px;\n  --pb-text-lg:16px;--pb-text-xl:20px;--pb-text-2xl:24px;\n\n  display:flex;flex-direction:column;height:100%;min-height:0;overflow:hidden;\n  background:var(--pb-bg);color:var(--pb-ink);\n  font:var(--pb-text-md)/1.55 -apple-system,BlinkMacSystemFont,\"SF Pro Text\",\"PingFang SC\",\"Hiragino Sans GB\",\"Microsoft YaHei\",sans-serif;\n  -webkit-font-smoothing:antialiased;\n  font-variant-numeric:tabular-nums;\n  container-type:inline-size;\n}\n.pb-root *{box-sizing:border-box}\n.pb-root button,.pb-root input,.pb-root select,.pb-root textarea{font:inherit;color:inherit}\n.pb-root button{cursor:pointer;transition:background-color .16s ease-out,border-color .16s ease-out,color .16s ease-out,box-shadow .16s ease-out,transform .16s ease-out}\n.pb-root button:active{transform:translateY(1px)}\n.pb-root button:disabled{opacity:.45;cursor:not-allowed}\n.pb-root button:focus-visible,.pb-root input:focus-visible,.pb-root select:focus-visible,.pb-root textarea:focus-visible{\n  outline:3px solid color-mix(in srgb,var(--pb-accent) 32%,transparent);outline-offset:2px;\n}\n.pb-root ::selection{background:var(--pb-tint-strong)}\n\n/* ---------- chrome ---------- */\n.pb-root header{\n  display:flex;align-items:center;gap:var(--pb-s3);flex-wrap:wrap;\n  min-height:56px;padding:var(--pb-s2) var(--pb-s5);\n  background:var(--pb-card);border-bottom:1px solid var(--pb-line);flex-shrink:0;\n}\n.pb-root header button{-webkit-app-region:no-drag}\n.pb-brand{display:inline-flex;align-items:center;gap:var(--pb-s2);font-weight:650;font-size:var(--pb-text-lg);letter-spacing:-.01em;white-space:nowrap}\n.pb-mark{\n  display:grid;place-items:center;width:28px;height:28px;border-radius:var(--pb-r-control);\n  background:var(--pb-tint);color:var(--pb-accent);font-size:var(--pb-text-xs);\n}\n.pb-tag{\n  background:var(--pb-tint);color:var(--pb-accent);border-radius:var(--pb-r-pill);\n  padding:var(--pb-s1) var(--pb-s3);font-size:var(--pb-text-xs);white-space:nowrap;font-weight:500;\n}\n.pb-flex{flex:1;min-width:var(--pb-s2)}\n.pb-toolbar{\n  display:flex;gap:var(--pb-s1);padding:var(--pb-s2) var(--pb-s5);\n  background:var(--pb-card);border-bottom:1px solid var(--pb-line);overflow-x:auto;flex-shrink:0;\n}\n.pb-toolbar button{\n  border:0;background:none;padding:var(--pb-s2) var(--pb-s4);min-height:40px;\n  border-radius:var(--pb-r-control);color:var(--pb-muted);white-space:nowrap;\n  font-size:var(--pb-text-sm);font-weight:500;\n}\n.pb-toolbar button:hover{background:var(--pb-line-soft);color:var(--pb-ink)}\n.pb-toolbar button.active{background:var(--pb-tint);color:var(--pb-accent);font-weight:600}\n.pb-context{\n  display:flex;justify-content:space-between;gap:var(--pb-s3);flex-wrap:wrap;\n  padding:var(--pb-s2) var(--pb-s5);background:var(--pb-card);color:var(--pb-muted);\n  font-size:var(--pb-text-sm);border-bottom:1px solid var(--pb-line);flex-shrink:0;\n}\n.pb-context b{color:var(--pb-ink);font-weight:600}\n.pb-scroll{flex:1;min-height:0;overflow:auto;padding:var(--pb-s6) var(--pb-s7) var(--pb-s8)}\n.pb-heading,.pb-stats,.pb-panel,.pb-layout,.pb-grid-2,.pb-grid-bench{max-width:1200px;margin-left:auto;margin-right:auto}\n.pb-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:var(--pb-s5);margin:0 auto var(--pb-s6)}\n.pb-eyebrow{\n  font-size:var(--pb-text-xs);letter-spacing:.12em;color:var(--pb-accent);\n  font-weight:650;margin-bottom:var(--pb-s2);text-transform:uppercase;\n}\n.pb-root h1{font-size:var(--pb-text-2xl);line-height:1.2;letter-spacing:-.02em;margin:0 0 var(--pb-s2);font-weight:650}\n.pb-root h2{font-size:var(--pb-text-lg);letter-spacing:-.01em;line-height:1.35;margin:0;font-weight:650}\n.pb-root p{margin:0 0 var(--pb-s3);max-width:72ch}\n.pb-sub{color:var(--pb-muted);font-size:var(--pb-text-sm);line-height:1.6}\n.pb-muted{color:var(--pb-muted)}\n.pb-actions{display:flex;gap:var(--pb-s2);flex-wrap:wrap;align-items:center}\n.pb-flex-line{display:flex;align-items:center;gap:var(--pb-s2);flex-wrap:wrap}\n\n/* ---------- controls ---------- */\n.pb-btn{\n  display:inline-flex;align-items:center;justify-content:center;gap:var(--pb-s1);\n  min-height:40px;padding:var(--pb-s2) var(--pb-s4);border-radius:var(--pb-r-control);\n  background:var(--pb-card);border:1px solid var(--pb-line);color:var(--pb-ink);\n  white-space:nowrap;font-size:var(--pb-text-sm);font-weight:500;\n}\n.pb-btn:hover{background:var(--pb-line-soft);border-color:color-mix(in srgb,var(--pb-line) 55%,var(--pb-muted))}\n.pb-btn.primary{background:var(--pb-accent);border-color:var(--pb-accent);color:var(--pb-accent-ink)}\n.pb-btn.primary:hover{background:var(--pb-accent-hover);border-color:var(--pb-accent-hover)}\n.pb-btn.primary:disabled{background:var(--pb-accent);border-color:var(--pb-accent)}\n.pb-link{\n  display:inline-flex;align-items:center;min-height:36px;padding:var(--pb-s1) var(--pb-s2);\n  border:0;background:none;color:var(--pb-accent);font-size:var(--pb-text-sm);font-weight:500;\n  border-radius:var(--pb-r-control);\n}\n.pb-link:hover{background:var(--pb-tint);text-decoration:none}\n.pb-link.danger{color:var(--pb-bad)}\n.pb-link.danger:hover{background:var(--pb-bad-tint)}\n.pb-chip{\n  display:inline-flex;align-items:center;gap:var(--pb-s1);padding:2px var(--pb-s2);border-radius:var(--pb-r-pill);\n  background:var(--pb-line-soft);color:var(--pb-muted);font-size:var(--pb-text-xs);font-weight:500;white-space:nowrap;\n}\n.pb-chip.ok{background:var(--pb-ok-tint);color:var(--pb-ok)}\n.pb-chip.live{background:var(--pb-tint);color:var(--pb-accent)}\n.pb-chip.warn{background:var(--pb-warn-tint);color:var(--pb-warn)}\n.pb-chip.bad{background:var(--pb-bad-tint);color:var(--pb-bad)}\n.pb-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:var(--pb-text-xs);letter-spacing:-.01em}\n.pb-select{min-height:36px;padding:var(--pb-s1) var(--pb-s3);border-radius:var(--pb-r-control);border:1px solid var(--pb-line);background:var(--pb-card);font-size:var(--pb-text-sm)}\n\n/* ---------- stat tiles ---------- */\n.pb-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:var(--pb-s4);margin-bottom:var(--pb-s6)}\n.pb-stats-tight{grid-template-columns:repeat(3,minmax(0,1fr))}\n.pb-stat{background:var(--pb-card);border:1px solid var(--pb-line);border-radius:var(--pb-r-card);padding:var(--pb-s5)}\n.pb-stat-label{color:var(--pb-muted);font-size:var(--pb-text-xs);font-weight:500;letter-spacing:.01em}\n.pb-stat-value{display:block;font-size:30px;line-height:1.15;letter-spacing:-.02em;font-weight:650;margin:var(--pb-s2) 0 var(--pb-s1)}\n.pb-stat-note{color:var(--pb-muted);font-size:var(--pb-text-sm);line-height:1.5;max-width:36ch}\n.pb-kpis{display:flex;gap:var(--pb-s6);flex-wrap:wrap;margin-bottom:var(--pb-s4)}\n.pb-kpi span{display:block;color:var(--pb-muted);font-size:var(--pb-text-xs);margin-bottom:var(--pb-s1)}\n.pb-kpi b{font-size:var(--pb-text-xl);letter-spacing:-.01em;font-weight:650}\n\n/* ---------- panels ---------- */\n.pb-panel{background:var(--pb-card);border:1px solid var(--pb-line);border-radius:var(--pb-r-card);margin-bottom:var(--pb-s5);overflow:hidden}\n.pb-panel-head{display:flex;align-items:flex-start;justify-content:space-between;gap:var(--pb-s4);padding:var(--pb-s5) var(--pb-s5) 0}\n.pb-panel-head .pb-sub{margin-top:var(--pb-s1);max-width:68ch}\n.pb-body{padding:var(--pb-s4) var(--pb-s5) var(--pb-s5)}\n.pb-grid-2{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:var(--pb-s5);margin-bottom:var(--pb-s5)}\n.pb-grid-2>.pb-panel{margin-bottom:0}\n.pb-defs{display:grid;gap:var(--pb-s2);font-size:var(--pb-text-sm);color:var(--pb-muted);line-height:1.65}\n.pb-defs b{display:inline-block;min-width:100px;color:var(--pb-ink);font-weight:600}\n.pb-plan-line{display:flex;justify-content:space-between;gap:var(--pb-s4);padding:var(--pb-s2) 0;border-bottom:1px solid var(--pb-line-soft);font-size:var(--pb-text-sm)}\n.pb-plan-line:last-child{border-bottom:0}\n.pb-plan-line span{color:var(--pb-muted)}\n.pb-plan-line b{text-align:right;font-weight:600;overflow-wrap:anywhere}\n.pb-finding{margin:0 0 var(--pb-s3);padding:var(--pb-s3) var(--pb-s4);background:var(--pb-tint);border-radius:var(--pb-r-control);color:var(--pb-accent);font-size:var(--pb-text-sm);line-height:1.7}\n.pb-cred .pb-plan-line b{font-weight:600}\n.pb-notice{padding:var(--pb-s3) var(--pb-s4);border-radius:var(--pb-r-control);background:var(--pb-bg);color:var(--pb-muted);font-size:var(--pb-text-sm);line-height:1.7;border:1px solid var(--pb-line-soft);margin-top:var(--pb-s3)}\n.pb-empty{color:var(--pb-faint);font-size:var(--pb-text-sm);padding:var(--pb-s6) 0;text-align:center}\n.pb-empty-state{padding:var(--pb-s7) var(--pb-s5);text-align:center;color:var(--pb-muted);max-width:60ch;margin:0 auto}\n.pb-empty-state p{margin-bottom:var(--pb-s4);font-size:var(--pb-text-sm);line-height:1.7}\n.pb-loading{padding:var(--pb-s7);text-align:center;color:var(--pb-muted);font-size:var(--pb-text-sm)}\n.pb-toast,.pb-error{position:sticky;top:0;z-index:5;display:flex;align-items:center;justify-content:space-between;gap:var(--pb-s3);padding:var(--pb-s3) var(--pb-s4);border-radius:var(--pb-r-control);margin:0 auto var(--pb-s4);max-width:1200px;font-size:var(--pb-text-sm);box-shadow:var(--pb-shadow-md)}\n.pb-toast{background:var(--pb-tint);border:1px solid var(--pb-tint-strong);color:var(--pb-accent)}\n.pb-error{background:var(--pb-bad-tint);border:1px solid color-mix(in srgb,var(--pb-bad) 24%,transparent);color:var(--pb-bad)}\n\n/* ---------- tables ---------- */\n.pb-table-wrap{overflow-x:auto;margin:0 calc(var(--pb-s5) * -1)}\n.pb-root table{width:100%;border-collapse:collapse;text-align:left}\n.pb-root th{\n  padding:var(--pb-s3) var(--pb-s5);font-size:var(--pb-text-xs);font-weight:600;letter-spacing:.04em;\n  color:var(--pb-faint);text-transform:uppercase;border-bottom:1px solid var(--pb-line);white-space:nowrap;background:transparent;\n}\n.pb-root td{padding:var(--pb-s3) var(--pb-s5);font-size:var(--pb-text-sm);line-height:1.5;vertical-align:middle;border-bottom:1px solid var(--pb-line-soft);height:48px}\n.pb-root tr:last-child td{border-bottom:0}\n.pb-root tbody tr{transition:background-color .16s ease-out}\n.pb-root tbody tr:hover{background:var(--pb-sunken)}\n.pb-root th.num,.pb-root td.num{text-align:right;white-space:nowrap}\n.pb-root td b{font-weight:600}\n\n/* ---------- forms ---------- */\n.pb-form{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:var(--pb-s5);align-items:start}\n.pb-form label{display:flex;flex-direction:column;gap:var(--pb-s1);font-size:var(--pb-text-sm);color:var(--pb-muted)}\n.pb-form label>span{font-weight:500;color:var(--pb-ink)}\n.pb-form .pb-wide{grid-column:1/-1}\n.pb-form input,.pb-form select,.pb-form textarea{\n  min-height:40px;padding:var(--pb-s2) var(--pb-s3);border-radius:var(--pb-r-control);\n  border:1px solid var(--pb-line);background:var(--pb-card);font-size:var(--pb-text-sm);width:100%;\n  transition:border-color .16s ease-out,box-shadow .16s ease-out;\n}\n.pb-form textarea{resize:vertical;line-height:1.6;min-height:88px}\n.pb-form input:hover,.pb-form select:hover,.pb-form textarea:hover{border-color:color-mix(in srgb,var(--pb-line) 55%,var(--pb-muted))}\n.pb-form input:focus,.pb-form select:focus,.pb-form textarea:focus{border-color:var(--pb-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--pb-accent) 14%,transparent);outline:none}\n.pb-form input:disabled{background:var(--pb-bg);color:var(--pb-faint)}\n.pb-root input[type=checkbox]{width:16px;height:16px;min-height:0;padding:0;border-radius:4px;accent-color:var(--pb-accent);flex:none}\n.pb-inline-inputs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--pb-s2)}\n.pb-check{flex-direction:row!important;align-items:center;gap:var(--pb-s2);color:var(--pb-ink);min-height:40px;font-size:var(--pb-text-sm)!important}\n.pb-check input{width:auto;min-height:auto;accent-color:var(--pb-accent)}\n.pb-check-list{display:flex;flex-direction:column;max-height:420px;overflow:auto}\n.pb-check-row{display:flex;align-items:center;gap:var(--pb-s3);padding:var(--pb-s2) 0;border-bottom:1px solid var(--pb-line-soft);font-size:var(--pb-text-sm);cursor:pointer;min-height:44px}\n.pb-check-row:last-child{border-bottom:0}\n.pb-check-row input{width:auto;min-height:auto;accent-color:var(--pb-accent)}\n.pb-check-row .pb-sub{margin-left:auto;text-align:right}\n\n/* ---------- bench layout ---------- */\n.pb-grid-bench{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);gap:var(--pb-s5);margin-bottom:var(--pb-s5)}\n.pb-side>.pb-panel:last-child{margin-bottom:0}\n\n/* ---------- results ---------- */\n.pb-layout{display:grid;grid-template-columns:280px minmax(0,1fr);gap:var(--pb-s5)}\n.pb-rail{background:var(--pb-card);border:1px solid var(--pb-line);border-radius:var(--pb-r-card);padding:var(--pb-s2);align-self:start;max-height:calc(100vh - 280px);overflow:auto}\n.pb-rail-title{padding:var(--pb-s2) var(--pb-s3);font-size:var(--pb-text-xs);letter-spacing:.06em;color:var(--pb-faint);text-transform:uppercase;font-weight:600}\n.pb-rail-item{display:block;width:100%;text-align:left;padding:var(--pb-s2) var(--pb-s3);border:0;background:none;border-radius:var(--pb-r-control);margin-bottom:var(--pb-s1);min-height:44px}\n.pb-rail-item:hover{background:var(--pb-line-soft)}\n.pb-rail-item.active{background:var(--pb-tint);color:var(--pb-accent)}\n.pb-rail-head{display:flex;align-items:center;justify-content:space-between;gap:var(--pb-s2);margin-bottom:var(--pb-s1)}\n.pb-rail-body{font-size:var(--pb-text-sm);font-weight:500;line-height:1.5}\n.pb-rail-body .pb-sub{font-weight:400}\n.pb-main{min-width:0}\n.pb-charts{display:grid;gap:var(--pb-s5)}\n.pb-chart-box{border:1px solid var(--pb-line-soft);border-radius:var(--pb-r-control);padding:var(--pb-s4) var(--pb-s4) var(--pb-s2);background:var(--pb-card)}\n.pb-legend{display:flex;gap:var(--pb-s4);flex-wrap:wrap;margin-bottom:var(--pb-s1);font-size:var(--pb-text-xs);color:var(--pb-muted)}\n.pb-legend span{display:inline-flex;align-items:center;gap:var(--pb-s1)}\n.pb-legend i{display:inline-block;width:8px;height:8px;border-radius:2px}\n.pb-chart{display:block;width:100%;height:auto}\n.pb-grid{stroke:var(--pb-line-soft);stroke-width:1}\n.pb-grid-base{stroke:var(--pb-line)}\n.pb-axis{fill:var(--pb-faint);font-size:var(--pb-text-xs)}\n.pb-line{fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}\n.pb-dot{stroke:var(--pb-card);stroke-width:2}\n.pb-diff{border:1px solid var(--pb-line);border-radius:var(--pb-r-control);background:var(--pb-card);padding:var(--pb-s4);margin-bottom:var(--pb-s4)}\n.pb-diff-head{display:flex;gap:var(--pb-s3);align-items:baseline;flex-wrap:wrap;margin-bottom:var(--pb-s1)}\n.pb-diff-block{margin-top:var(--pb-s3)}\n.pb-diff-block b{display:block;font-size:var(--pb-text-xs);color:var(--pb-muted);margin-bottom:var(--pb-s1)}\n.pb-diff-block pre{white-space:pre-wrap;overflow-wrap:anywhere;font:var(--pb-text-xs)/1.7 ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--pb-bg);border:1px solid var(--pb-line-soft);border-radius:var(--pb-r-control);padding:var(--pb-s3) var(--pb-s4);margin:0;max-height:220px;overflow:auto}\n.pb-report{white-space:pre-wrap;overflow-wrap:anywhere;font:var(--pb-text-sm)/1.8 ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--pb-bg);border:1px solid var(--pb-line-soft);border-radius:var(--pb-r-control);padding:var(--pb-s4);margin:0 var(--pb-s5) var(--pb-s5);max-height:520px;overflow:auto}\n\n.pb-foot{display:flex;justify-content:space-between;gap:var(--pb-s3);flex-wrap:wrap;padding:var(--pb-s2) var(--pb-s5);border-top:1px solid var(--pb-line);background:var(--pb-card);color:var(--pb-faint);font-size:var(--pb-text-xs);flex-shrink:0}\n\n/* ---------- plan catalog ---------- */\n.pb-plan-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:var(--pb-s4)}\n.pb-plan-card{\n  border:1px solid var(--pb-line);border-radius:var(--pb-r-card);padding:var(--pb-s5);\n  display:flex;flex-direction:column;gap:var(--pb-s2);cursor:pointer;background:var(--pb-card);\n  transition:border-color .16s ease-out,box-shadow .16s ease-out,transform .16s ease-out,background-color .16s ease-out;\n  min-height:100%;\n}\n.pb-plan-card:hover,.pb-plan-card:focus-visible{border-color:color-mix(in srgb,var(--pb-accent) 45%,var(--pb-line));box-shadow:var(--pb-shadow-md);transform:translateY(-1px);outline:none}\n.pb-plan-card.selected{border-color:var(--pb-accent);background:var(--pb-tint);box-shadow:var(--pb-shadow-sm)}\n.pb-plan-card p{margin:0;font-size:var(--pb-text-sm);line-height:1.6;color:var(--pb-muted);max-width:60ch}\n.pb-plan-head{display:flex;align-items:center;justify-content:space-between;gap:var(--pb-s2)}\n.pb-plan-head b{font-size:var(--pb-text-md);font-weight:600;letter-spacing:-.01em;line-height:1.4}\n.pb-chips{display:flex;flex-wrap:wrap;gap:var(--pb-s1)}\n.pb-plan-dims{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:var(--pb-s1) var(--pb-s4);margin:var(--pb-s1) 0 var(--pb-s2)}\n.pb-inline{display:flex;gap:var(--pb-s2);align-items:center}\n.pb-inline input{flex:1}\n.pb-plan-failed{border-left:2px solid var(--pb-bad);padding:var(--pb-s3) var(--pb-s4);margin:var(--pb-s2) 0;background:var(--pb-bad-tint);border-radius:var(--pb-r-control)}\n.pb-plan-failed-head{display:flex;gap:var(--pb-s2);align-items:center;flex-wrap:wrap}\n.pb-plan-failed pre{margin:var(--pb-s1) 0;white-space:pre-wrap;font-size:var(--pb-text-xs);line-height:1.6;max-height:120px;overflow:auto}\n\n/* ---------- dark ---------- */\n[data-ds-dark-theme] .pb-root{\n  --pb-bg:#0f141a;\n  --pb-card:#161d26;\n  --pb-raised:#1b232e;\n  --pb-sunken:#1a222c;\n  --pb-ink:#e8edf5;\n  --pb-muted:#a3aebd;\n  --pb-faint:#7f8b9c;\n  --pb-line:#29323e;\n  --pb-line-soft:#202832;\n  --pb-accent:#93a0ff;\n  --pb-accent-hover:#a8b4ff;\n  --pb-accent-ink:#0e1220;\n  --pb-tint:#202a4a;\n  --pb-tint-strong:#28335c;\n  --pb-ok:#5fd3a0;\n  --pb-ok-tint:#1b3529;\n  --pb-warn:#e8b464;\n  --pb-warn-tint:#382f1f;\n  --pb-bad:#ff938a;\n  --pb-bad-tint:#3a2422;\n  --pb-shadow-sm:0 1px 2px rgba(0,0,0,.35);\n  --pb-shadow-md:0 1px 2px rgba(0,0,0,.35),0 8px 24px rgba(0,0,0,.30);\n  --pb-shadow-pop:0 2px 4px rgba(0,0,0,.4),0 12px 32px rgba(0,0,0,.36);\n}\n[data-ds-dark-theme] .pb-root tbody tr:hover{background:var(--pb-sunken)}\n[data-ds-dark-theme] .pb-btn.primary:hover{background:var(--pb-accent-hover);border-color:var(--pb-accent-hover)}\n[data-ds-dark-theme] .pb-plan-card.selected{background:var(--pb-tint);box-shadow:var(--pb-shadow-sm)}\n\n@container (max-width:860px){\n  .pb-stats,.pb-stats-tight{grid-template-columns:repeat(2,minmax(0,1fr))}\n  .pb-grid-2,.pb-grid-bench,.pb-layout{grid-template-columns:minmax(0,1fr)}\n  .pb-rail{max-height:none}\n  .pb-scroll{padding:var(--pb-s5) var(--pb-s4) var(--pb-s7)}\n  .pb-heading{flex-wrap:wrap;gap:var(--pb-s3)}\n  .pb-form{grid-template-columns:minmax(0,1fr)}\n  .pb-inline-inputs{grid-template-columns:minmax(0,1fr)}\n  .pb-plan-cards{grid-template-columns:minmax(0,1fr)}\n}\n@media (prefers-reduced-motion:reduce){.pb-root *{transition:none!important;animation:none!important;transform:none!important}}\n\n/* ---------- pricing editor ---------- */\n.pb-price-block{grid-column:1/-1;border-top:1px solid var(--pb-line-soft);margin-top:var(--pb-s2);padding-top:var(--pb-s5)}\n.pb-price-title{font-size:var(--pb-text-sm);font-weight:600}\n.pb-price-grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--pb-s4);margin-top:var(--pb-s3)}\n.pb-price-windows{margin-top:var(--pb-s4);display:grid;gap:var(--pb-s2)}\n.pb-window-row{display:grid;grid-template-columns:1.1fr .8fr .6fr .6fr .5fr auto;gap:var(--pb-s2);align-items:center}\n.pb-window-row input,.pb-window-row select{min-height:36px;padding:var(--pb-s1) var(--pb-s2);border:1px solid var(--pb-line);border-radius:var(--pb-r-control);background:var(--pb-card);font-size:var(--pb-text-sm);width:100%}\n.pb-window-row .pb-link{min-height:36px}\n@container (max-width:860px){\n  .pb-price-grid{grid-template-columns:minmax(0,1fr)}\n  .pb-window-row{grid-template-columns:minmax(0,1fr) minmax(0,1fr);}\n}\n";
const API='/api/llm-api-perf/';
const PAGES=[['overview','总览'],['targets','目标配置'],['bench','发起压测'],['plans','测试方案'],['parity','一致性校验'],['results','运行结果'],['compare','对比']];
const fmtNum=(v,d=1)=>{if(v==null||!Number.isFinite(Number(v)))return '—';const n=Number(v);return n<0?'—':n.toFixed(d)};
const fmtMs=v=>v==null||!Number.isFinite(Number(v))||v<0?'—':Math.round(Number(v))+' ms';
const fmtPct=v=>v==null||!Number.isFinite(Number(v))?'—':Number(v).toFixed(1)+'%';
const fmtInt=v=>v==null||!Number.isFinite(Number(v))?'—':Math.round(Number(v)).toLocaleString();
const parseList=text=>String(text||'').split(/[,，\s]+/).map(x=>Number(x.trim())).filter(x=>Number.isFinite(x)&&x>0);
const shortId=id=>String(id||'').slice(0,8);
const PROVIDER_PRESETS=[
 {id:'deepseek',label:'DeepSeek 官方',base_url:'https://api.deepseek.com/v1',models:['deepseek-chat','deepseek-reasoner']},
 {id:'openai',label:'OpenAI 官方',base_url:'https://api.openai.com/v1',models:['gpt-4o-mini','gpt-4o']},
 {id:'dashscope',label:'阿里云百炼（OpenAI 兼容）',base_url:'https://dashscope.aliyuncs.com/compatible-mode/v1',models:['qwen-plus','qwen-max','qwen-turbo']},
 {id:'ark',label:'火山方舟',base_url:'https://ark.cn-beijing.volces.com/api/v3',models:[]},
 {id:'siliconflow',label:'硅基流动',base_url:'https://api.siliconflow.cn/v1',models:[]},
 {id:'openrouter',label:'OpenRouter（聚合）',base_url:'https://openrouter.ai/api/v1',models:[]},
 {id:'local',label:'本机 / 局域网（OpenAI 兼容）',base_url:'http://127.0.0.1:8000/v1',models:[]}
];
const DEFAULT_PRICING={enabled:false,currency:'CNY',input:'',output:'',cached_input:'',vendor_discount_pct:'0',batch_discount_pct:'0',timezone:'Asia/Shanghai',windows:[]};
const WEEKDAY_PRESETS=[{id:'all',label:'每天',days:[1,2,3,4,5,6,7]},{id:'work',label:'工作日',days:[1,2,3,4,5]},{id:'weekend',label:'周末',days:[6,7]}];
function pricingOf(target){return target&&target.pricing&&target.pricing.enabled?target.pricing:null}
function weekdayPreset(days){const list=(days||[]).join(',');const hit=WEEKDAY_PRESETS.find(item=>item.days.join(',')===list);return hit?hit.id:'all'}
function parsePricingDays(id){const hit=WEEKDAY_PRESETS.find(item=>item.id===id);return hit?hit.days:[1,2,3,4,5,6,7]}
const DIM_LABELS={knowledge:'事实知识',reasoning:'推理与数学',code:'代码理解',instruction:'指令遵循',long_context:'长上下文',safety:'安全拒答',stability:'稳定性',usage:'用量账本',custom:'自定义语料',consistency:'一致性',performance:'性能'};
const statusTone=status=>({completed:'ok',running:'live',cancelled:'warn',failed:'bad',interrupted:'warn'}[status]||'');
const statusText=status=>({completed:'已完成',running:'运行中',cancelled:'已取消',failed:'失败',interrupted:'中断'}[status]||status||'—');
function colorVar(name){return 'var(--pb-'+name+')'}
function chart(series,opts){
 const W=660,H=opts.height||220,pad={l:56,r:18,t:16,b:30};
 const count=Math.max(0,...series.map(s=>s.points.length));
 const points=series.flatMap(s=>s.points).filter(p=>Number.isFinite(p.y));
 if(!points.length||count===0)return h('div',{className:'pb-empty'},opts.empty||'本次运行没有可绘制的数据');
 const values=points.map(p=>p.y);
 let min=Math.min(...values),max=Math.max(...values);
 if(min===max){min=Math.max(0,min*0.9);max=max===0?1:max*1.1}
 if(min>0&&min/max>0.5){min=min-Math.abs(max-min)*0.35;if(min<0)min=0}
 const xs=Array.from({length:count},(_,i)=>i);
 const px=i=>pad.l+(count<=1?0:(i/(count-1))*(W-pad.l-pad.r));
 const py=v=>pad.t+(1-(v-min)/(max-min))*(H-pad.t-pad.b);
 const ticks=[0,0.25,0.5,0.75,1].map(t=>min+(max-min)*t);
 const tickText=v=>Math.abs(v)>=100?Math.round(v):Math.abs(v)>=10?v.toFixed(1):v.toFixed(2);
 return h('svg',{viewBox:'0 0 '+W+' '+H,className:'pb-chart',role:'img','aria-label':opts.label||'指标曲线'},
  ticks.map((v,i)=>h('line',{key:'g'+i,x1:pad.l,x2:W-pad.r,y1:py(v),y2:py(v),className:i===0?'pb-grid pb-grid-base':'pb-grid'})),
  ticks.map((v,i)=>h('text',{key:'y'+i,x:pad.l-10,y:py(v)+4,textAnchor:'end',className:'pb-axis'},tickText(v))),
  xs.map(i=>h('text',{key:'x'+i,x:px(i),y:H-10,textAnchor:'middle',className:'pb-axis'},opts.xLabels?opts.xLabels[i]:i+1)),
  series.map(s=>{
   const valid=s.points.map((p,i)=>({x:i,y:p.y})).filter(p=>Number.isFinite(p.y));
   return h('g',{key:s.name},
    valid.length>1&&h('polyline',{points:valid.map(p=>px(p.x)+','+py(p.y)).join(' '),className:'pb-line',style:{stroke:s.color}}),
    valid.map(p=>h('circle',{key:'d'+p.x,cx:px(p.x),cy:py(p.y),r:4,fill:s.color,className:'pb-dot'})));
  }),
  opts.unit&&h('text',{x:pad.l,y:12,className:'pb-axis'},opts.unit)
 );
}

function apply(ctx){
 const STYLE='llm-perf-workbench-style';
 ctx.effect(()=>{const tag=document.createElement('style');tag.id=STYLE;tag.textContent=CSS;document.head.appendChild(tag);return()=>tag.remove()});
 async function request(path,init){
  const options={credentials:'same-origin',cache:'no-store',...init,headers:{...(init&&init.body?{'Content-Type':'application/json'}:{}),...(init&&init.headers?init.headers:{})}};
  const response=await fetch(API+path,options);
  let payload=null;
  try{payload=await response.json()}catch{}
  if(!response.ok)throw Error((payload&&payload.error)||('HTTP '+response.status));
  return payload;
 }
 function download(result){
  const url=URL.createObjectURL(new Blob([result.content],{type:result.mime||'application/octet-stream'}));
  const anchor=document.createElement('a');anchor.href=url;anchor.download=result.filename;anchor.click();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
 }

 function Panel({service,entry}){
  const [host,setHost]=useState(()=>service.getSnapshot());
  const [snapshot,setSnapshot]=useState(null);
  const [page,setPage]=useState('overview');
  const [runId,setRunId]=useState(null);
  const [detail,setDetail]=useState(null);
  const [detailRound,setDetailRound]=useState(0);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [toast,setToast]=useState('');
  const [draft,setDraft]=useState(null);
  const [testResult,setTestResult]=useState(null);
  const [reportText,setReportText]=useState('');
  const [compareIds,setCompareIds]=useState([]);
  const [compareData,setCompareData]=useState(null);
  const [chatOpen,setChatOpen]=useState(true);
  const [bench,setBench]=useState({target_id:'',mode:'closed',concurrency:'1,2,4,8',rate:'1,2,4',number:'30',warmup:'2',max_tokens:'256',stream:true,duration_sec:'',dataset_source:'builtin',random_tokens:'512',p99_ttft_ms:'',p99_latency_ms:'',min_success_rate:'',sleep_between_rounds_sec:'2'});
  const [parity,setParity]=useState({target_a:'',target_b:'',dataset_source:'builtin',file_path:'',repeats:'1',temperature:'0',seed:'42',max_tokens:'256',judge_enabled:false,judge_target_id:'',judge_swap:true,judge_rubric:''});
  const [parityRunId,setParityRunId]=useState(null);
  const [parityDetail,setParityDetail]=useState(null);
  const [parityReportText,setParityReportText]=useState('');
  const [providerPreset,setProviderPreset]=useState('');
  const [modelOptions,setModelOptions]=useState([]);
  const [modelLoading,setModelLoading]=useState(false);
  const [plans,setPlans]=useState({mode:'standard',plan_id:'capability-spot',target_a:'',target_b:'',dimensions:['knowledge','instruction'],per_dimension:'0',repeats:'1',temperature:'0',seed:'42',max_tokens:'256',long_context_lengths:'4000,16000',long_context_depths:'front,middle,end',judge_enabled:false,judge_target_id:'',judge_rubric:'',dataset_source:'builtin',file_path:'',pricing_mode:'standard'});
  const [planRunId,setPlanRunId]=useState(null);
  const [planDetail,setPlanDetail]=useState(null);
  const [planReportText,setPlanReportText]=useState('');
  const rootRef=useRef(null),epoch=useRef(0),toastTimer=useRef(null),pollRef=useRef(null);
  const sid=service.currentSession();
  const owned=sid&&host.state&&host.state.sessionBindings&&host.state.sessionBindings[sid]===entry.id?sid:null;

  function notify(text){setToast(text);if(toastTimer.current)clearTimeout(toastTimer.current);toastTimer.current=setTimeout(()=>setToast(''),5000)}
  useEffect(()=>()=>{if(toastTimer.current)clearTimeout(toastTimer.current)},[]);
  useEffect(()=>service.subscribe(()=>setHost(service.getSnapshot())),[service]);
  // 跨边界铁律（见全局技能 dsh-cross-boundary-css / 航才项目 LESSONS.md）：
  // 状态类只挂自己的 .pb-root；:has() 匹配 DOM 不匹配 hidden，宿主切日常模式 =
  // 给 .dshWbBusiness 设 hidden（不移除），链上必须带 :not([hidden]) 守卫；
  // 收起状态不持久化、不写宿主 class，模式切换靠选择器条件自然失效。
  useEffect(()=>{
   const root=rootRef.current,body=root&&root.closest('.dshWbBody');
   if(body)body.classList.remove('pb-chat-collapsed');
   if(!root)return undefined;
   root.classList.toggle('pb-chat-collapsed',!chatOpen);
   return ()=>root.classList.remove('pb-chat-collapsed');
  },[chatOpen]);
  // 兜底：宿主切日常对话模式（隐藏业务面板 aside 或移除框架）时自动恢复对话展开
  useEffect(()=>{
   const root=rootRef.current;if(!root)return undefined;
   const targets=[root.closest('.dshWbBody'),root.closest('.dshWbBusiness')].filter(Boolean);
   if(!targets.length)return undefined;
   const gone=e=>!document.contains(e)||e.hidden||getComputedStyle(e).display==='none'||getComputedStyle(e).visibility==='hidden';
   const restore=()=>{if(targets.some(gone))setChatOpen(true)};
   const mo=new MutationObserver(restore);
   for(const e of targets){mo.observe(e,{attributes:true,attributeFilter:['hidden','style','class']});if(e.parentNode)mo.observe(e.parentNode,{childList:true})}
   restore();
   return ()=>mo.disconnect();
  },[]);

  const refresh=useCallback(async()=>{
   const ticket=++epoch.current;
   const next=await request('snapshot'+(owned?'?session_id='+encodeURIComponent(owned):''));
   if(ticket===epoch.current)setSnapshot(next);
   return next;
  },[owned]);

  useEffect(()=>{
   let disposed=false;
   const tick=()=>refresh().catch(e=>{if(!disposed)setError(e.message)});
   tick();
   pollRef.current=setInterval(tick,2500);
   return ()=>{disposed=true;clearInterval(pollRef.current);epoch.current++};
  },[refresh]);

  useEffect(()=>{
   if(!runId)return undefined;
   let disposed=false;let ticket=0;
   const load=async()=>{const current=++ticket;try{const data=await request('run-detail?run_id='+encodeURIComponent(runId)+(owned?'&session_id='+encodeURIComponent(owned):''));if(!disposed&&current===ticket)setDetail(data)}catch(e){if(!disposed)setError(e.message)}};
   load();
   const timer=setInterval(load,1500);
   return ()=>{disposed=true;clearInterval(timer)};
  },[runId,owned]);

  useEffect(()=>{
   if(!parityRunId)return undefined;
   let disposed=false;let ticket=0;
   const load=async()=>{const current=++ticket;try{const data=await request('parity-detail?run_id='+encodeURIComponent(parityRunId)+(owned?'&session_id='+encodeURIComponent(owned):''));if(!disposed&&current===ticket)setParityDetail(data)}catch(e){if(!disposed)setError(e.message)}};
   load();
   const timer=setInterval(load,1500);
   return ()=>{disposed=true;clearInterval(timer)};
  },[parityRunId,owned]);

  useEffect(()=>{
   if(!planRunId)return undefined;
   let disposed=false;let ticket=0;
   const load=async()=>{const current=++ticket;try{const data=await request('plan-detail?run_id='+encodeURIComponent(planRunId)+(owned?'&session_id='+encodeURIComponent(owned):''));if(!disposed&&current===ticket)setPlanDetail(data)}catch(e){if(!disposed)setError(e.message)}};
   load();
   const timer=setInterval(load,1500);
   return ()=>{disposed=true;clearInterval(timer)};
  },[planRunId,owned]);

  useEffect(()=>{
   if(!snapshot)return;
   const targets=snapshot.targets||[];
   setBench(current=>{
    if(current.target_id&&targets.some(t=>t.id===current.target_id))return current;
    const target=targets[0];
    return target?{...current,target_id:target.id}:current;
   });
   const latest=(snapshot.runs||[]).find(r=>r.status==='completed');
   if(latest)setRunId(current=>current||latest.id);
   setParity(current=>{
    let next=current;
    if(!current.target_a||!targets.some(t=>t.id===current.target_a))next={...next,target_a:targets[0]?targets[0].id:''};
    if(!next.target_b||next.target_b===next.target_a||!targets.some(t=>t.id===next.target_b))next={...next,target_b:(targets.find(t=>t.id!==next.target_a)||{}).id||''};
    return next;
   });
   const latestParity=(snapshot.parity_runs||[])[0];
   if(latestParity)setParityRunId(current=>current||latestParity.id);
   setPlans(current=>{
    let next=current;
    if(!next.target_a||!targets.some(t=>t.id===next.target_a))next={...next,target_a:targets[0]?targets[0].id:''};
    if(next.target_b&&!targets.some(t=>t.id===next.target_b))next={...next,target_b:''};
    if(next.target_b&&next.target_b===next.target_a)next={...next,target_b:''};
    return next;
   });
   const latestPlan=(snapshot.plan_runs||[])[0];
   if(latestPlan)setPlanRunId(current=>current||latestPlan.id);
  },[snapshot]);

  useEffect(()=>{
   if(page!=='compare'||!compareIds.length){setCompareData(null);return}
   request('compare',{method:'POST',body:JSON.stringify({run_ids:compareIds.join(',')})}).then(setCompareData).catch(e=>setError(e.message));
  },[page,compareIds]);

  const targets=(snapshot&&snapshot.targets)||[];
  const runs=(snapshot&&snapshot.runs)||[];
  const limits=(snapshot&&snapshot.limits)||{maxConcurrency:2048,maxRate:5000,maxNumber:20000};
  const activeRun=runs.find(r=>r.status==='running');

  async function guard(task,okMessage){
   setBusy(true);setError('');setReportText('');
   try{const result=await task();if(okMessage)notify(okMessage);await refresh();return result}
   catch(e){setError(e.message);return null}
   finally{setBusy(false)}
  }

  async function fillDraft(text,okMessage){
   setChatOpen(true);setError('');
   try{
    let target=owned;
    if(!target){
     const folder=await ctx.uiWorkspace.pickDirectory();
     if(!folder)return;
     target=await ctx.desktopWorkbenches.ensureSession({folder});
     if(!target)return;
    }
    if(!ctx.desktopWorkbenches.ownsSession(target))throw Error('请先打开当前工作台会话');
    const source=ctx.uiSession.current.getSnapshot();
    if(source.key!==target)throw Error('会话尚在切换，请稍后重试');
    const actions=source.props.inputActions;
    if(!actions||!actions.setDraft)throw Error('原生会话输入尚未就绪');
    const current=source.hooks.input.getSnapshot().draft||'';
    actions.setDraft(current?current+'\n\n'+text:text);
    setError(okMessage||'');
   }catch(e){setError(e.message)}
  }
  function ask(question){return fillDraft(question,'已将问题填入右侧原生 Chat 草稿，请检查后发送。')}

  function planPayload(){
   const slo={};
   if(bench.p99_ttft_ms!=='')slo.p99_ttft_ms=Number(bench.p99_ttft_ms);
   if(bench.p99_latency_ms!=='')slo.p99_latency_ms=Number(bench.p99_latency_ms);
   if(bench.min_success_rate!=='')slo.min_success_rate=Number(bench.min_success_rate);
   return {
    mode:bench.mode,
    concurrency:bench.mode==='closed'?parseList(bench.concurrency):[1],
    rate:bench.mode==='open'?parseList(bench.rate):[1],
    number:Number(bench.number),
    warmup:bench.warmup===''?0:Number(bench.warmup),
    max_tokens:Number(bench.max_tokens),
    stream:Boolean(bench.stream),
    duration_sec:bench.duration_sec===''?null:Number(bench.duration_sec),
    sleep_between_rounds_sec:Number(bench.sleep_between_rounds_sec),
    dataset:{source:bench.dataset_source,random_tokens:Number(bench.random_tokens)},
    slo
   };
  }

  async function startRun(){
   const plan=planPayload();
   if(bench.mode==='closed'&&!plan.concurrency.length){setError('请填写至少一个并发档位，例如 1,2,4,8');return}
   if(bench.mode==='open'&&!plan.rate.length){setError('请填写至少一个到达速率档位，例如 1,2,4');return}
   const result=await guard(()=>request('run',{method:'POST',body:JSON.stringify({target_id:bench.target_id,plan,session_id:owned||undefined})}),'压测已开始，可在「运行结果」查看进度。');
   if(result&&result.run_id){setRunId(result.run_id);setPage('results')}
  }
  async function cancelRun(id){await guard(()=>request('cancel',{method:'POST',body:JSON.stringify({run_id:id,session_id:owned||undefined})}),'已请求取消。')}
  async function saveTarget(){
   const payload={...draft};
   if(payload.headers_text&&payload.headers_text.trim()){
    try{payload.headers=JSON.parse(payload.headers_text)}catch{setError('请求头必须是合法 JSON');return}
   }
   delete payload.headers_text;
   await guard(()=>request('targets-save',{method:'POST',headers:{'x-llm-perf-human-review':'1'},body:JSON.stringify(payload)}),payload.id?'目标已更新。':'目标已保存。').then(saved=>{if(saved)setDraft(null)});
  }
  async function deleteTarget(id){
   if(!window.confirm('删除该检测目标？已产生运行记录会保留，但不再能对它发起新压测。'))return;
   await guard(()=>request('targets-delete',{method:'POST',headers:{'x-llm-perf-human-review':'1'},body:JSON.stringify({target_id:id})}),'目标已删除。');
  }
  async function testTarget(id){
   setTestResult(null);
   const result=await guard(()=>request('test',{method:'POST',body:JSON.stringify({target_id:id,session_id:owned||undefined})}));
   if(result)setTestResult({id,...result});
  }
  async function showReport(id){
   const result=await guard(()=>request('report',{method:'POST',body:JSON.stringify({run_id:id,session_id:owned||undefined})}));
   if(result)setReportText(result.markdown);
  }
  async function exportRun(id,format){
   const result=await guard(()=>request('export',{method:'POST',body:JSON.stringify({run_id:id,format,session_id:owned||undefined})}));
   if(result){download(result);notify('已生成「'+result.filename+'」并开始下载。')}
  }
  function parityPlanPayload(){
   return {
    target_a:parity.target_a,target_b:parity.target_b,
    dataset:{source:parity.dataset_source==='file'?'file':'builtin',file_path:parity.dataset_source==='file'?(parity.file_path||''):''},
    repeats:Number(parity.repeats),temperature:Number(parity.temperature),
    seed:parity.seed===''?null:Number(parity.seed),max_tokens:Number(parity.max_tokens),
    judge:{enabled:Boolean(parity.judge_enabled),target_id:parity.judge_target_id||null,swap:Boolean(parity.judge_swap),rubric:parity.judge_rubric||''}
   };
  }
  async function startParity(){
   if(!parity.target_a||!parity.target_b){setError('请选择目标 A 与目标 B');return}
   if(parity.target_a===parity.target_b){setError('目标 A 与目标 B 不能相同');return}
   if(parity.dataset_source==='file'&&!String(parity.file_path||'').trim()){setError('请填写提示词 JSONL 的绝对路径');return}
   if(parity.judge_enabled&&!parity.judge_target_id){setError('启用 LLM 评审时请选择评审目标');return}
   const result=await guard(()=>request('parity-run',{method:'POST',body:JSON.stringify({plan:parityPlanPayload(),session_id:owned||undefined})}),'一致性校验已开始。');
   if(result&&result.run_id){setParityRunId(result.run_id);setParityReportText('')}
  }
  async function cancelParity(id){await guard(()=>request('parity-cancel',{method:'POST',body:JSON.stringify({run_id:id,session_id:owned||undefined})}),'已请求取消一致性校验。')}
  async function showParityReport(id){
   const result=await guard(()=>request('parity-report',{method:'POST',body:JSON.stringify({run_id:id,session_id:owned||undefined})}));
   if(result){setParityReportText(result.markdown);setParityRunId(id)}
  }
  async function exportParity(id,format){
   const result=await guard(()=>request('parity-export',{method:'POST',body:JSON.stringify({run_id:id,format,session_id:owned||undefined})}));
   if(result){download(result);notify('已生成「'+result.filename+'」并开始下载。')}
  }

  function planPayload(){
   return {
    plan_id:plans.mode==='custom'?'custom':plans.plan_id,
    target_a:plans.target_a,
    target_b:plans.target_b||null,
    dimensions:plans.mode==='custom'?plans.dimensions:undefined,
    per_dimension:plans.per_dimension===''?0:Number(plans.per_dimension),
    repeats:Number(plans.repeats),
    temperature:Number(plans.temperature),
    seed:plans.seed===''?null:Number(plans.seed),
    max_tokens:Number(plans.max_tokens),
    long_context:{lengths:parseList(plans.long_context_lengths),depths:String(plans.long_context_depths||'').split(',').map(x=>x.trim()).filter(Boolean)},
    dataset:{source:plans.dataset_source,file_path:plans.dataset_source==='file'?String(plans.file_path||'').trim():''},
    judge:{enabled:Boolean(plans.judge_enabled),target_id:plans.judge_target_id||null,rubric:plans.judge_rubric||''},
    pricing_mode:plans.pricing_mode||'standard'
   };
  }
  async function startPlan(){
   if(!plans.target_a){setError('请选择目标 A（待测端点）');return}
   if(plans.mode==='custom'&&!plans.dimensions.length){setError('定制方案至少选择一个评测维度');return}
   if(plans.mode==='custom'&&plans.dataset_source==='file'&&!String(plans.file_path||'').trim()){setError('选择文件语料时请填写 JSONL 绝对路径');return}
   if(plans.judge_enabled&&!plans.judge_target_id){setError('启用评审时请选择评审目标');return}
   const selectedPlan=((snapshot&&snapshot.plans)||[]).find(plan=>plan.id===plans.plan_id);
   if(selectedPlan&&selectedPlan.requires_b&&!plans.target_b){setError('该方案需要目标 B（官方参考端点）：没有参照就无法判断 usage 是否虚高');return}
   const result=await guard(()=>request('plan-run',{method:'POST',body:JSON.stringify({plan:planPayload(),session_id:owned||undefined})}),'测试方案已开始。');
   if(result&&result.run_id){setPlanRunId(result.run_id);setPlanReportText('')}
  }
  async function cancelPlan(id){await guard(()=>request('plan-cancel',{method:'POST',body:JSON.stringify({run_id:id,session_id:owned||undefined})}),'已请求取消测试方案。')}
  async function showPlanReport(id){
   const result=await guard(()=>request('plan-report',{method:'POST',body:JSON.stringify({run_id:id,session_id:owned||undefined})}));
   if(result){setPlanReportText(result.markdown);setPlanRunId(id)}
  }
  async function exportPlan(id,format){
   const result=await guard(()=>request('plan-export',{method:'POST',body:JSON.stringify({run_id:id,format,session_id:owned||undefined})}));
   if(result){download(result);notify('已生成「'+result.filename+'」并开始下载。')}
  }
  async function discoverModels(){
   if(!draft)return;
   const useStored=Boolean(draft.id)&&!String(draft.api_key||'').trim();
   if(!String(draft.base_url||'').trim()){setError('请先填写接口地址（可选择供应商预设）');return}
   setModelLoading(true);setError('');
   try{
    const result=await request('models-discover',{method:'POST',headers:{'x-llm-perf-human-review':'1'},body:JSON.stringify({base_url:draft.base_url,api_key:useStored?'':draft.api_key,target_id:useStored?draft.id:null})});
    setModelOptions(result.models||[]);
    notify(result.models&&result.models.length?('已拉取 '+result.models.length+' 个模型，可从下拉选择。'):(result.hint||'接口没有返回模型列表，请手动填写模型 ID。'));
   }catch(e){setError(e.message)}
   finally{setModelLoading(false)}
  }

  function toggleCompare(id){
   setCompareIds(current=>current.includes(id)?current.filter(x=>x!==id):(current.length>=6?current:[...current,id]));
  }

  const stat=(label,value,note)=>h('div',{className:'pb-stat'},h('div',{className:'pb-stat-label'},label),h('strong',{className:'pb-stat-value'},value),note&&h('div',{className:'pb-stat-note'},note));
  const chip=(text,tone)=>h('span',{className:'pb-chip'+(tone?' pb-chip-'+tone:'')},text);
  const table=(labels,rows,numCols)=>h('div',{className:'pb-table-wrap'},h('table',{className:'pb-table'},
   h('thead',null,h('tr',null,...labels.map((label,i)=>h('th',{key:i,className:numCols&&numCols.includes(i)?'num':''},label)))),
   h('tbody',null,...rows.map((cells,r)=>h('tr',{key:r},...cells.map((cell,c)=>h('td',{key:c,className:numCols&&numCols.includes(c)?'num':''},cell)))))));
  const heading=(eyebrow,title,sub,right)=>h('div',{className:'pb-heading'},
   h('div',null,h('div',{className:'pb-eyebrow'},eyebrow),h('h1',null,title),sub&&h('p',{className:'pb-sub'},sub)),right);
  const notice=text=>h('div',{className:'pb-notice'},text);
  const empty=(text,action)=>h('div',{className:'pb-empty-state'},h('p',null,text),action);
  const section=(title,sub,right,body)=>h('section',{className:'pb-panel'},h('div',{className:'pb-panel-head'},h('div',null,h('h2',null,title),sub&&h('div',{className:'pb-sub'},sub)),right),body);

  function roundLabel(round){return round.parallel!=null?round.parallel+' 并发':round.rate+' req/s'}
  function p99Of(round,metric){
   if(!round||!round.percentiles)return null;
   const index=round.percentiles.percentiles.indexOf('99%');
   const column=round.percentiles.columns[metric];
   return index<0||!column?null:column[index];
  }

  function overview(){
   const completed=runs.filter(r=>r.status==='completed');
   const latest=completed[0];
   const sloRuns=runs.filter(r=>r.slo_max!=null);
   const latestBody=latest
    ?h('div',{className:'pb-body'},
      h('div',{className:'pb-kpis'},
       h('div',{className:'pb-kpi'},h('span',null,'RPS'),h('b',null,fmtNum(latest.headline&&latest.headline.qps,2))),
       h('div',{className:'pb-kpi'},h('span',null,'TTFT P99'),h('b',null,fmtMs(latest.headline&&latest.headline.p99_ttft_ms))),
       h('div',{className:'pb-kpi'},h('span',null,'输出 tok/s'),h('b',null,fmtNum(latest.headline&&latest.headline.output_tokens_per_second))),
       h('div',{className:'pb-kpi'},h('span',null,'成功率'),h('b',null,fmtPct(latest.headline&&latest.headline.success_rate)))),
      h('div',{className:'pb-sub'},'目标 '+(latest.target&&latest.target.name||'—')+' · 模型 '+(latest.target&&latest.target.model||'—')+' · '+(latest.plan&&latest.plan.mode==='open'?'开环':'闭环')+' · '+(latest.round_count||0)+' 个档位'))
    :empty('还没有运行记录。先在「目标配置」添加接口，再发起第一次压测。',
      h('button',{className:'pb-btn',onClick:()=>setPage('targets')},'添加目标'));
   const definitions=h('div',{className:'pb-body pb-defs'},
    h('div',null,h('b',null,'TTFT'),'首个携带可观测输出的流式帧到达时间，含连接、排队与预填充。'),
    h('div',null,h('b',null,'TPOT / ITL'),'TPOT=(总延迟−TTFT)/(输出 token−1)；ITL 是相邻输出帧间隔，看输出抖动。'),
    h('div',null,h('b',null,'RPS / tok/s'),'分母统一为首请求发出到末请求完成的墙钟时间，与 EvalScope、vLLM bench 一致。'),
    h('div',null,h('b',null,'P99'),'最近秩分位数，不是线性插值；样本量小时 P99 不具统计意义。'),
    h('div',null,h('b',null,'最大并发'),'由「吞吐不再随并发上升」与「SLO 仍满足」共同判定的上界，不是一次测得的数字。'));
   const recent=runs.length
    ?table(['状态','目标 / 模型','模式','档位','RPS','TTFT P99','输出 tok/s','成功率','操作'],
      runs.slice(0,8).map(r=>[
       chip(statusText(r.status),statusTone(r.status)),
       h('div',null,h('div',null,r.target&&r.target.name||'—'),h('div',{className:'pb-sub'},r.target&&r.target.model||'')),
       r.plan&&r.plan.mode==='open'?'开环':'闭环',
       (r.plan&&r.plan.list||[]).join(' / '),
       r.headline?fmtNum(r.headline.qps,2):'—',
       r.headline?fmtMs(r.headline.p99_ttft_ms):'—',
       r.headline?fmtNum(r.headline.output_tokens_per_second):'—',
       r.headline?fmtPct(r.headline.success_rate):'—',
       h('div',{className:'pb-actions'},
        h('button',{className:'pb-link',onClick:()=>{setRunId(r.id);setPage('results')}},'查看'),
        r.status==='running'&&h('button',{className:'pb-link',onClick:()=>cancelRun(r.id)},'取消'))]),
      [4,5,6,7])
    :empty('暂无运行记录。');
   return h(React.Fragment,null,
    heading('LLM API SERVICE QUALITY','本地 API 服务质量检测台','先配置目标，再做并发阶梯；结论要落在 P99 与 SLO 上，而不是一个吞吐峰值。',
     h('div',{className:'pb-actions'},
      h('button',{className:'pb-btn',onClick:()=>setPage('targets')},'配置目标'),
      h('button',{className:'pb-btn primary',onClick:()=>setPage('bench')},'发起压测'))),
    h('div',{className:'pb-stats'},
     stat('已配置目标',targets.length+' 个','API Key 只存本机，界面与 Chat 均不回显'),
     stat('运行记录',runs.length+' 次',completed.length+' 次已完成'),
     stat('最近状态',latest?statusText(latest.status):'—',latest&&latest.target?latest.target.name:'尚未运行'),
     stat('SLO 边界',sloRuns.length?String(sloRuns[0].slo_max):'—',sloRuns.length?'满足声明 SLO 的最高档位':'未设置 SLO 阈值')),
    h('div',{className:'pb-grid-2'},
     section('最近运行','最近一次完成的运行摘要',
      latest?h('button',{className:'pb-btn',onClick:()=>{setRunId(latest.id);setPage('results')}},'查看详情 →'):null,
      latestBody),
     section('检测口径','这些定义决定了数字能不能横向比较',null,definitions)),
    section('最近运行记录',null,null,recent));
  }

  function targetsPage(){
   const editing=draft;
   const rows=targets.map(t=>[
    h('div',null,h('div',null,t.name),t.note&&h('div',{className:'pb-sub'},t.note)),
    h('div',null,h('div',{className:'pb-mono'},t.base_url),h('div',{className:'pb-sub'},(t.headers||[]).length?('自定义头 '+(t.headers||[]).join(', ')):'仅默认头')),
    h('span',{className:'pb-mono'},t.model),
    t.endpoint==='completions'?'/completions':'/chat',
    t.has_api_key?h('span',{className:'pb-mono'},t.api_key_hint||'已设置'):chip('未设置','warn'),
    pricingOf(t)?chip('已配置','ok'):chip('未配置',''),
    t.updated_at?new Date(t.updated_at).toLocaleString():'—',
    h('div',{className:'pb-actions'},
     h('button',{className:'pb-link',onClick:()=>testTarget(t.id),disabled:busy},'测试连接'),
     h('button',{className:'pb-link',onClick:()=>setDraft({...t,api_key:'',headers_text:'',headers_keep:true,pricing:t.pricing||{...DEFAULT_PRICING}})},'编辑'),
     h('button',{className:'pb-link danger',onClick:()=>deleteTarget(t.id),disabled:busy},'删除'))]);
   const list=targets.length
    ?table(['名称','接口','模型','端点','密钥','计价','最近更新','操作'],rows,[6])
    :empty('还没有目标。点击右上角「新增目标」，填入 OpenAI 兼容接口地址与模型名。');
   const testBlock=testResult
    ?section('连接测试结果','只验证鉴权与端点可达性，不代表性能',
      h('button',{className:'pb-link',onClick:()=>setTestResult(null)},'关闭'),
      h('div',{className:'pb-body'},
       h('div',{className:'pb-kpis'},
        h('div',{className:'pb-kpi'},h('span',null,'结果'),h('b',null,testResult.ok?'连通':'失败')),
        h('div',{className:'pb-kpi'},h('span',null,'延迟'),h('b',null,fmtMs(testResult.latency_ms)))),
       testResult.error&&notice('错误：'+testResult.error)))
    :null;
   const setPricing=(patch)=>setDraft(current=>({...current,pricing:{...(current.pricing||DEFAULT_PRICING),...patch}}));
   const setWindow=(index,patch)=>setDraft(current=>{const pricing={...(current.pricing||DEFAULT_PRICING)};const windows=[...(pricing.windows||[])];windows[index]={...windows[index],...patch};return {...current,pricing:{...pricing,windows}}});
   const addWindow=()=>setDraft(current=>{const pricing={...(current.pricing||DEFAULT_PRICING)};const windows=[...(pricing.windows||[])];if(windows.length>=3)return current;windows.push({label:'闲时',weekdays:[1,2,3,4,5,6,7],start:'00:00',end:'08:00',multiplier:'0.5'});return {...current,pricing:{...pricing,windows}}});
   const removeWindow=(index)=>setDraft(current=>{const pricing={...(current.pricing||DEFAULT_PRICING)};const windows=(pricing.windows||[]).filter((_,i)=>i!==index);return {...current,pricing:{...pricing,windows}}});
   const currentPricing=(editing&&editing.pricing)||DEFAULT_PRICING;
   const pricingForm=editing
    ?h('div',{className:'pb-wide pb-price-block'},
      h('div',{className:'pb-flex-line'},h('b',{className:'pb-price-title'},'计费价目表（可选）'),chip('仅存本机',''),h('span',{className:'pb-sub'},'单位：每 1,000,000 token；成本按服务端上报 usage 计算')),
      h('label',{className:'pb-check'},h('input',{type:'checkbox',checked:Boolean(currentPricing.enabled),onChange:e=>setPricing({enabled:e.target.checked})}),h('span',null,'启用成本核算（不启用也能跑质量方案，但报告不会计算成本）')),
      currentPricing.enabled?h(React.Fragment,null,
       h('div',{className:'pb-form pb-price-grid'},
        h('label',null,h('span',null,'币种'),h('select',{value:currentPricing.currency||'CNY',onChange:e=>setPricing({currency:e.target.value})},h('option',{value:'CNY'},'CNY 人民币'),h('option',{value:'USD'},'USD 美元'))),
        h('label',null,h('span',null,'输入单价 / 百万 token'),h('input',{type:'number',min:'0',step:'0.01',value:currentPricing.input,onChange:e=>setPricing({input:e.target.value})})),
        h('label',null,h('span',null,'输出单价 / 百万 token'),h('input',{type:'number',min:'0',step:'0.01',value:currentPricing.output,onChange:e=>setPricing({output:e.target.value})})),
        h('label',null,h('span',null,'缓存命中单价（可选）'),h('input',{type:'number',min:'0',step:'0.01',value:currentPricing.cached_input==null?'':currentPricing.cached_input,onChange:e=>setPricing({cached_input:e.target.value})})),
        h('label',null,h('span',null,'厂商折扣 %'),h('input',{type:'number',min:'0',max:'100',step:'1',value:currentPricing.vendor_discount_pct,onChange:e=>setPricing({vendor_discount_pct:e.target.value})})),
        h('label',null,h('span',null,'批量任务折扣 %'),h('input',{type:'number',min:'0',max:'100',step:'1',value:currentPricing.batch_discount_pct,onChange:e=>setPricing({batch_discount_pct:e.target.value})})),
        h('label',null,h('span',null,'时区'),h('input',{value:currentPricing.timezone||'Asia/Shanghai',onChange:e=>setPricing({timezone:e.target.value}),placeholder:'Asia/Shanghai'}))),
       h('div',{className:'pb-price-windows'},
        h('div',{className:'pb-flex-line'},h('span',{className:'pb-sub'},'时段倍率：闲时/忙时可用倍率表达，重叠窗口按乘法叠加；默认价倍率为 1。'),h('button',{className:'pb-btn',type:'button',onClick:addWindow,disabled:(currentPricing.windows||[]).length>=3},'添加时段')),
        (currentPricing.windows||[]).map((window,index)=>h('div',{className:'pb-window-row',key:index},
         h('input',{value:window.label||'',placeholder:'标签，如 闲时',onChange:e=>setWindow(index,{label:e.target.value})}),
         h('select',{value:weekdayPreset(window.weekdays),onChange:e=>setWindow(index,{weekdays:parsePricingDays(e.target.value)})},...WEEKDAY_PRESETS.map(item=>h('option',{value:item.id,key:item.id},item.label))),
         h('input',{type:'time',value:window.start||'00:00',onChange:e=>setWindow(index,{start:e.target.value})}),
         h('input',{type:'time',value:window.end||'08:00',onChange:e=>setWindow(index,{end:e.target.value})}),
         h('input',{type:'number',min:'0.01',max:'10',step:'0.01',value:window.multiplier,onChange:e=>setWindow(index,{multiplier:e.target.value})}),
         h('button',{className:'pb-link danger',type:'button',onClick:()=>removeWindow(index)},'移除'))),
        !(currentPricing.windows||[]).length?h('div',{className:'pb-sub'},'未设置时段：全天按标准价。若厂商有闲时/忙时价，添加一条窗口即可。'):null),
       h('div',{className:'pb-sub'},'叠加顺序：单价 × 时段倍率 × (1−厂商折扣) × (1−批量折扣；仅“按批量任务计价”运行时)。价格只存本机，报告会带价格快照。')):h('div',{className:'pb-sub'},'不启用时不读取 Key、也不影响目标保存；消耗型指标仍可正常压测。')):null;
   const form=editing
    ?section(editing.id?'编辑目标':'新增目标','保存与删除需要界面确认；Agent 无法调用这两个动作',
      h('div',{className:'pb-actions'},
       h('button',{className:'pb-btn',onClick:()=>setDraft(null)},'取消'),
       h('button',{className:'pb-btn primary',onClick:saveTarget,disabled:busy},'保存目标')),
      h('div',{className:'pb-body pb-form'},
       h('label',null,h('span',null,'名称'),h('input',{value:editing.name,onChange:e=>setDraft({...editing,name:e.target.value}),placeholder:'例如：云厂商 A / 自建 vLLM'})),
       h('label',null,h('span',null,'供应商预设（可选）'),h('select',{value:providerPreset,onChange:e=>{const preset=PROVIDER_PRESETS.find(item=>item.id===e.target.value);setProviderPreset(e.target.value);if(preset){setModelOptions(preset.models||[]);setDraft(current=>({...current,base_url:preset.base_url,model:current.model||(preset.models&&preset.models[0])||''}))}}},
        h('option',{value:''},'— 手动填写 / 不使用预设 —'),...PROVIDER_PRESETS.map(preset=>h('option',{value:preset.id,key:preset.id},preset.label)))),
       h('label',null,h('span',null,'接口地址'),h('input',{value:editing.base_url,onChange:e=>setDraft({...editing,base_url:e.target.value}),placeholder:'https://api.example.com/v1'})),
       h('label',null,h('span',null,'模型（可从接口拉取后选择）'),h('div',{className:'pb-inline'},
        h('input',{list:'pb-model-options',value:editing.model,onChange:e=>setDraft({...editing,model:e.target.value}),placeholder:'模型 ID，例如 qwen-max'}),
        h('button',{className:'pb-btn',type:'button',onClick:discoverModels,disabled:modelLoading},modelLoading?'拉取中…':'拉取模型列表'),
        h('datalist',{id:'pb-model-options'},...modelOptions.map(id=>h('option',{value:id,key:id}))))),
       h('div',{className:'pb-wide pb-sub'},'模型列表来自 '+((editing&&editing.base_url)||'{base_url}')+'/models；端点不支持列表时可手动填写模型 ID。拉取会使用本机保存的 Key（或本次填写的 Key），Key 不会回显。'),
       h('label',null,h('span',null,'端点'),h('select',{value:editing.endpoint||'chat',onChange:e=>setDraft({...editing,endpoint:e.target.value})},h('option',{value:'chat'},'/chat/completions'),h('option',{value:'completions'},'/completions'))),
       h('label',null,h('span',null,'API Key'),h('input',{type:'password',value:editing.api_key||'',onChange:e=>setDraft({...editing,api_key:e.target.value}),placeholder:editing.id?'留空表示保持原密钥不变':'sk-…'})),
       h('label',{className:'pb-wide'},h('span',null,'自定义请求头（JSON，可选）'),h('textarea',{value:editing.headers_text||'',onChange:e=>setDraft({...editing,headers_text:e.target.value}),rows:3,placeholder:'{"x-team":"perf"}'})),
       h('label',{className:'pb-wide'},h('span',null,'备注（可选）'),h('input',{value:editing.note||'',onChange:e=>setDraft({...editing,note:e.target.value}),placeholder:'例如：华东区、生产通道'})),
       pricingForm))
    :null;
   return h(React.Fragment,null,
    heading('ENDPOINTS','目标配置','API Key 只写入本机数据目录（文件权限 0600），保存后界面只显示末四位；Agent 与报告都读不到原文。',
     h('button',{className:'pb-btn'+(editing?'':' primary'),onClick:()=>setDraft({name:'',base_url:'',model:'',endpoint:'chat',api_key:'',headers_text:'',note:'',pricing:{...DEFAULT_PRICING}})},editing?'正在编辑…':'新增目标')),
    section('检测目标',null,null,list),
    testBlock,
    form);
  }

  function benchPage(){
   const selected=targets.find(t=>t.id===bench.target_id);
   const set=(key)=>(event)=>{
    const value=event.target.type==='checkbox'?event.target.checked:event.target.value;
    setBench(current=>({...current,[key]:value}));
   };
   const preview=bench.mode==='closed'?parseList(bench.concurrency):parseList(bench.rate);
   return h(React.Fragment,null,
    heading('LOAD TEST','发起压测','闭环用于测“能承载多少并发”，开环用于测“给定到达压力下的表现”；两者结论不可混用。',
     h('div',{className:'pb-actions'},
      activeRun&&h('button',{className:'pb-btn',onClick:()=>cancelRun(activeRun.id)},'取消当前运行'),
      h('button',{className:'pb-btn primary',onClick:startRun,disabled:busy||!bench.target_id},'开始压测'))),
    h('div',{className:'pb-grid-bench'},
     section('参数','所有档位共用同一套提示词与输出上限，避免用不同负载横向比较',null,
      h('div',{className:'pb-body pb-form'},
       h('label',null,h('span',null,'检测目标'),h('select',{value:bench.target_id,onChange:set('target_id')},
        ...targets.map(t=>h('option',{value:t.id,key:t.id},t.name+' · '+t.model)))),
       h('label',null,h('span',null,'发压模式'),h('select',{value:bench.mode,onChange:set('mode')},h('option',{value:'closed'},'闭环：并发上限 + 背压'),h('option',{value:'open'},'开环：泊松到达，不看完成'))),
       h('label',null,h('span',null,bench.mode==='closed'?'并发档位':'到达速率档位'),h('input',{value:bench.mode==='closed'?bench.concurrency:bench.rate,onChange:set(bench.mode==='closed'?'concurrency':'rate'),placeholder:'1,2,4,8'})),
       h('label',null,h('span',null,'每档请求数'),h('input',{type:'number',min:1,max:limits.maxNumber,value:bench.number,onChange:set('number')})),
       h('label',null,h('span',null,'每档预热数'),h('input',{type:'number',min:0,value:bench.warmup,onChange:set('warmup')})),
       h('label',null,h('span',null,'最大输出 token'),h('input',{type:'number',min:1,max:limits.maxTokens,value:bench.max_tokens,onChange:set('max_tokens')})),
       h('label',null,h('span',null,'提示词来源'),h('select',{value:bench.dataset_source,onChange:set('dataset_source')},h('option',{value:'builtin'},'内置语料（短/中/长混合）'),h('option',{value:'random'},'随机填充文本'),h('option',{value:'file'},'本地 JSONL'))),
       h('label',null,h('span',null,'随机填充 token 数'),h('input',{type:'number',min:16,value:bench.random_tokens,onChange:set('random_tokens'),disabled:bench.dataset_source!=='random'})),
       h('label',null,h('span',null,'限时（秒，可空）'),h('input',{type:'number',min:5,value:bench.duration_sec,onChange:set('duration_sec'),placeholder:'空 = 按请求数跑完'})),
       h('label',{className:'pb-wide pb-check'},h('input',{type:'checkbox',checked:bench.stream,onChange:set('stream')}),h('span',null,'流式 SSE（测 TTFT/TPOT 必须开启）')),
       h('label',{className:'pb-wide'},h('span',null,'SLO 阈值（可空，用于判定“最大可承载并发”）'),
        h('div',{className:'pb-inline-inputs'},
         h('input',{type:'number',placeholder:'P99 TTFT 上限 ms',value:bench.p99_ttft_ms,onChange:set('p99_ttft_ms')}),
         h('input',{type:'number',placeholder:'P99 延迟上限 ms',value:bench.p99_latency_ms,onChange:set('p99_latency_ms')}),
         h('input',{type:'number',placeholder:'最低成功率 %',value:bench.min_success_rate,onChange:set('min_success_rate')}))))),
     h('div',{className:'pb-side'},
      section('本次计划','提交后开始真实请求，会产生对外计费',null,
       h('div',{className:'pb-body'},
        h('div',{className:'pb-plan-line'},h('span',null,'目标'),h('b',null,selected?selected.name+' · '+selected.model:'未选择')),
        h('div',{className:'pb-plan-line'},h('span',null,'档位'),h('b',null,preview.length?preview.join(' / '):'未填写')),
        h('div',{className:'pb-plan-line'},h('span',null,'总请求数'),h('b',null,fmtInt((preview.length||0)*Number(bench.number||0))+' 条（不含预热）')),
        h('div',{className:'pb-plan-line'},h('span',null,'模式'),h('b',null,bench.mode==='closed'?'闭环':'开环')),
        notice('预估耗时随服务端速度变化，未做提前估算。请确认该端点允许此规模压测。'))),
      section('运行中','指标在每档结束后汇总，运行中只显示进度',null,
       activeRun?h('div',{className:'pb-body'},
        h('div',{className:'pb-kpis'},
         h('div',{className:'pb-kpi'},h('span',null,'当前档位'),h('b',null,(activeRun.progress&&activeRun.progress.current_round||0)+'/'+(activeRun.progress&&activeRun.progress.total_rounds||'?'))),
         h('div',{className:'pb-kpi'},h('span',null,'完成/失败'),h('b',null,fmtInt(activeRun.progress&&activeRun.progress.completed)+' / '+fmtInt(activeRun.progress&&activeRun.progress.failed))),
         h('div',{className:'pb-kpi'},h('span',null,'档位键'),h('b',{className:'pb-mono'},activeRun.progress&&activeRun.progress.round_key||'—'))),
        h('button',{className:'pb-btn',onClick:()=>{setRunId(activeRun.id);setPage('results')}},'查看实时结果'))
       :h('div',{className:'pb-body'},h('div',{className:'pb-sub'},'当前没有运行中的压测。'))))));
  }

  function resultsPage(){
   const rounds=(detail&&detail.rounds)||[];
   const current=rounds[detailRound]||rounds[rounds.length-1]||null;
   const analysis=detail&&detail.analysis;
   const headingEl=heading('RUN DETAIL','运行结果',
    detail?(detail.target?detail.target.name+' · '+detail.target.model+' · '+shortId(detail.id):shortId(detail.id)):'选择一次运行查看分档指标',
    detail?h('div',{className:'pb-actions'},
     detail.status==='running'&&h('button',{className:'pb-btn',onClick:()=>cancelRun(detail.id)},'取消运行'),
     h('button',{className:'pb-btn',onClick:()=>showReport(detail.id),disabled:busy},'生成报告'),
     h('button',{className:'pb-btn',onClick:()=>exportRun(detail.id,'json')},'导出 JSON'),
     h('button',{className:'pb-btn',onClick:()=>exportRun(detail.id,'csv')},'导出 CSV'),
     h('button',{className:'pb-btn',onClick:()=>exportRun(detail.id,'md')},'导出 Markdown')):null);
   const rail=h('aside',{className:'pb-rail'},
    h('div',{className:'pb-rail-title'},'运行记录'),
    runs.length?null:empty('暂无运行记录。'),
    ...runs.slice(0,30).map(r=>h('button',{key:r.id,className:'pb-rail-item'+(detail&&detail.id===r.id?' active':''),onClick:()=>{setRunId(r.id);setDetailRound(0);setReportText('')}},
     h('div',{className:'pb-rail-head'},chip(statusText(r.status),statusTone(r.status)),h('span',{className:'pb-sub'},new Date(r.created_at).toLocaleString())),
     h('div',{className:'pb-rail-body'},(r.target&&r.target.name||'—'),h('span',{className:'pb-sub'},' · '+(r.plan&&r.plan.mode==='open'?'开环':'闭环')+' · '+(r.round_count||0)+'档')))));
   const kpis=detail?h('div',{className:'pb-stats pb-stats-tight'},
    stat('状态',statusText(detail.status),detail.status==='running'?'第 '+(detail.progress&&detail.progress.current_round||1)+' 档进行中':'档位 '+(detail.round_count||0)+' 个'),
    stat('RPS（末档）',detail.headline?fmtNum(detail.headline.qps,2):'—','成功请求 / 墙钟秒'),
    stat('TTFT P99',detail.headline?fmtMs(detail.headline.p99_ttft_ms):'—','末档流式请求'),
    stat('输出吞吐',detail.headline?fmtNum(detail.headline.output_tokens_per_second)+' tok/s':'—',detail.headline?'≈ '+fmtInt(detail.headline.output_tokens_per_minute)+' tok/min':''),
    stat('成功率',detail.headline?fmtPct(detail.headline.success_rate):'—','失败请求会拉低该值'),
    stat('SLO 边界',analysis&&analysis.slo?String(analysis.slo.max_within_slo):'—',analysis&&analysis.slo?'满足 SLO 的最高档位':'未设置阈值')):null;
   const legend=(items)=>h('div',{className:'pb-legend'},...items.map(item=>h('span',{key:item.label},h('i',{style:{background:item.color}}),item.label)));
   const chartSection=rounds.length>1?section('并发曲线','每条线是一档负载的实测值；曲线触顶前不能声明最大并发',null,
    h('div',{className:'pb-body pb-charts'},
     h('div',{className:'pb-chart-box'},
      legend([{color:colorVar('accent'),label:'RPS'},{color:colorVar('ok'),label:'输出 tok/s'}]),
      chart([
       {name:'RPS',color:colorVar('accent'),points:rounds.map(r=>({y:r.summary?r.summary.qps:NaN}))},
       {name:'tok/s',color:colorVar('ok'),points:rounds.map(r=>({y:r.summary?r.summary.output_token_throughput:NaN}))}
      ],{xLabels:rounds.map(roundLabel),label:'吞吐与并发曲线',unit:'req/s · tok/s'})),
     h('div',{className:'pb-chart-box'},
      legend([{color:colorVar('accent'),label:'TTFT 均值'},{color:colorVar('warn'),label:'TTFT P99'}]),
      chart([
       {name:'TTFT',color:colorVar('accent'),points:rounds.map(r=>({y:r.summary?r.summary.avg_ttft*1000:NaN}))},
       {name:'TTFT P99',color:colorVar('warn'),points:rounds.map(r=>({y:p99Of(r,'TTFT (ms)')}))}
      ],{xLabels:rounds.map(roundLabel),label:'TTFT 与并发曲线',unit:'ms'})),
     h('div',{className:'pb-chart-box'},
      legend([{color:colorVar('accent'),label:'延迟 P99'}]),
      chart([{name:'P99 延迟',color:colorVar('accent'),points:rounds.map(r=>({y:(p99Of(r,'Latency (s)')||0)*1000}))}],
       {xLabels:rounds.map(roundLabel),label:'P99 延迟与并发曲线',unit:'ms'})))):null;
   const roundRows=rounds.map((r,i)=>[
    h('b',null,roundLabel(r)),
    r.summary?fmtInt(r.summary.total_requests):'—',
    r.summary?fmtPct(r.summary.success_rate):'—',
    r.summary?fmtNum(r.summary.qps,2):'—',
    r.summary?fmtNum(r.summary.output_token_throughput):'—',
    r.summary?fmtInt(r.summary.output_tokens_per_minute):'—',
    r.summary?fmtMs(r.summary.avg_ttft*1000):'—',
    fmtMs(p99Of(r,'TTFT (ms)')),
    r.summary?fmtMs(r.summary.avg_tpot*1000):'—',
    fmtMs((p99Of(r,'Latency (s)')||0)*1000),
    h('button',{className:'pb-link',onClick:()=>setDetailRound(i)},'分位数')]);
   const tableSection=rounds.length?section('分档指标','预热已剔除；P99 为最近秩',null,
    h('div',{className:'pb-body'},
     table(['档位','请求','成功率','RPS','输出 tok/s','输出 tok/min','TTFT 均值','TTFT P99','TPOT 均值','延迟 P99','操作'],roundRows,[1,2,3,4,5,6,7,8,9]))):null;
   const analysisBody=analysis&&analysis.bottleneck?h('div',{className:'pb-body'},
    h('p',{className:'pb-finding'},analysis.bottleneck.message),
    analysis.bottleneck.peak&&h('div',{className:'pb-plan-line'},h('span',null,'吞吐峰值'),h('b',null,fmtNum(analysis.bottleneck.peak.qps,2)+' req/s @ '+analysis.bottleneck.peak.value+'（'+(analysis.bottleneck.peak.dimension==='concurrency'?'并发':'req/s 到达率')+'）')),
    analysis.bottleneck.latency_amplification&&h('div',{className:'pb-plan-line'},h('span',null,'末档/首档延迟放大'),h('b',null,fmtNum(analysis.bottleneck.latency_amplification,2)+'×')),
    analysis.slo
     ?h('div',null,
       h('p',{className:'pb-finding'},analysis.slo.message),
       table(['档位','P99 TTFT','P99 延迟','成功率','结论'],analysis.slo.checks.map(c=>[
        String(c.value),fmtMs(c.p99_ttft_ms),fmtMs(c.p99_latency_ms),fmtPct(c.success_rate),
        c.ok?chip('满足','ok'):chip('未达标','bad')+' '+c.failures.join('；')]),[1,2,3]))
     :notice('本次未设置 SLO 阈值，因此无法给出「最大可承载并发」；只能给吞吐峰值与曲线形状。换档位时请同时设置阈值。'),
    !analysis.slo&&notice('提示：SLO 阈值可在下次压测参数中设置，判定会随运行一起保存。')):null;
   const analysisSection=analysisBody?section('判定','瓶颈与 SLO 结论都由分档曲线推出，不允许只报峰值',null,analysisBody):null;
   const percentileSection=current&&current.percentiles?section('分位数明细',
    (current.summary?'档位 '+roundLabel(current)+' · ':'')+'最近秩：'+(current.percentiles.percentiles||[]).join(' / '),
    h('select',{className:'pb-select',value:detailRound,onChange:e=>setDetailRound(Number(e.target.value))},
     ...rounds.map((r,i)=>h('option',{value:i,key:r.key},roundLabel(r)))),
    h('div',{className:'pb-body'},
     table(['指标',...(current.percentiles.percentiles||[])],
      Object.keys(current.percentiles.columns).map(name=>[name,...current.percentiles.columns[name].map(value=>fmtNum(value,2))]),
      Array.from({length:(current.percentiles.percentiles||[]).length+1},(_,i)=>i)))):null;
   const sources=rounds.reduce((acc,r)=>{const item=r.token_sources||{};acc.usage+=item.usage||0;acc.estimate+=item.estimate||0;acc.missing+=item.missing||0;return acc},{usage:0,estimate:0,missing:0});
   const credibilitySection=detail?section('数据可信度','决定这份报告能不能用于对外结论',null,
    h('div',{className:'pb-body pb-cred'},
     h('div',{className:'pb-plan-line'},h('span',null,'样本'),h('b',null,(detail.samples?fmtInt(detail.samples.count):'—')+' 条（预热 '+(detail.samples?fmtInt(detail.samples.warmup):'—')+'，失败 '+(detail.samples?fmtInt(detail.samples.failed):'—')+'）')),
     h('div',{className:'pb-plan-line'},h('span',null,'token 来源'),h('b',null,sources.usage+' 条服务端 usage · '+sources.estimate+' 条估算 · '+sources.missing+' 条缺失')),
     notice('未测量：队列等待与预填充拆分、reasoning token 与可见 token 区分、多轮与缓存命中、服务端 GPU/调度指标。跨公网结果包含本机出口网络，不代表服务端内部时延。'))):null;
   const reportSection=reportText?section('报告预览','与导出的 Markdown 是同一份内容',
    h('button',{className:'pb-link',onClick:()=>setReportText('')},'收起'),
    h('pre',{className:'pb-report'},reportText)):null;
   const main=h('main',{className:'pb-main'},
    detail?h(React.Fragment,null,kpis,chartSection,tableSection,analysisSection,percentileSection,credibilitySection,reportSection):empty('请选择左侧的一次运行。'));
   return h(React.Fragment,null,headingEl,h('div',{className:'pb-layout'},rail,main));
  }

  function parityPage(){
   const pr=parityDetail;
   const parityRuns=(snapshot&&snapshot.parity_runs)||[];
   const activeP=parityRuns.find(r=>r.status==='running'||r.status==='cancelling');
   const setP=(key)=>(event)=>{const value=event.target.type==='checkbox'?event.target.checked:event.target.value;setParity(current=>({...current,[key]:value}))};
   const field=(text,control,wide)=>h('label',{className:wide?'pb-wide':''},h('span',null,text),control);
   const ratePct=value=>value==null||!Number.isFinite(Number(value))?'—':(Number(value)*100).toFixed(1)+'%';
   const intervalText=interval=>!interval||interval.low==null?'—':ratePct(interval.low)+'–'+ratePct(interval.high);
   const verdictLabel=value=>!value?'':({PASS:'一致',WARN:'需人工复核',FAIL:'不一致',INSUFFICIENT:'样本不足'}[value.status]||value.status);
   const qualityLabel=value=>!value?'':({DIFFERENT:'存在差异',NO_DIFFERENCE:'未发现差异',INSUFFICIENT:'样本不足'}[value.status]||value.status);
   const summary=pr&&pr.summary;
   const paritySummary=summary&&summary.parity;
   const qualitySummary=summary&&summary.quality;
   const judge=qualitySummary&&qualitySummary.judge;
   const rows=(pr&&pr.rows)||[];
   const diffs=(summary&&summary.diffs)||[];
   const judgeTargets=targets;
   const yesNo=(value)=>value===true?chip('是','ok'):value===false?chip('否','bad'):chip('—');

   const formSection=section('校验参数','目标必须已在「目标配置」中添加；API Key 仍只保存在本机数据目录',null,
    h('div',{className:'pb-body pb-form'},
     field('目标 A（基准端点）',h('select',{value:parity.target_a,onChange:setP('target_a')},h('option',{value:''},'— 请选择 —'),...targets.map(t=>h('option',{value:t.id,key:t.id},t.name+' · '+t.model)))),
     field('目标 B（待核对端点）',h('select',{value:parity.target_b,onChange:setP('target_b')},h('option',{value:''},'— 请选择 —'),...targets.map(t=>h('option',{value:t.id,key:t.id},t.name+' · '+t.model)))),
     field('提示词集',h('select',{value:parity.dataset_source,onChange:setP('dataset_source')},
      h('option',{value:'builtin'},'内置一致性语料（12 条，含金标）'),h('option',{value:'file'},'本机 JSONL 文件（可含金标与评分标准）'))),
     parity.dataset_source==='file'?field('提示词 JSONL 绝对路径',h('input',{type:'text',value:parity.file_path,placeholder:'/Users/you/parity-prompts.jsonl',onChange:setP('file_path')}),true):null,
     field('每条提示词重复次数',h('input',{type:'number',min:'1',max:'3',value:parity.repeats,onChange:setP('repeats')})),
     field('max_tokens',h('input',{type:'number',min:'16',max:'2048',value:parity.max_tokens,onChange:setP('max_tokens')})),
     field('temperature（建议 0）',h('input',{type:'number',min:'0',max:'2',step:'0.1',value:parity.temperature,onChange:setP('temperature')})),
     field('seed（固定采样）',h('input',{type:'number',min:'0',value:parity.seed,onChange:setP('seed')})),
     field('启用 LLM 评审（额外 token 费用）',h('input',{type:'checkbox',checked:Boolean(parity.judge_enabled),onChange:setP('judge_enabled')})),
     field('评审目标',h('select',{value:parity.judge_target_id,onChange:setP('judge_target_id'),disabled:!parity.judge_enabled},
      h('option',{value:''},'— 未选择 —'),...judgeTargets.map(t=>h('option',{value:t.id,key:t.id},t.name+' · '+t.model)))),
     field('评审时互换 A/B 顺序',h('input',{type:'checkbox',checked:Boolean(parity.judge_swap),onChange:setP('judge_swap'),disabled:!parity.judge_enabled})),
     field('评审评分标准（可选）',h('input',{type:'text',value:parity.judge_rubric,placeholder:'例如：准确性优先，其次是格式与完整性',onChange:setP('judge_rubric')}),true),
     h('div',{className:'pb-wide pb-sub'},'默认 12 条提示词全部判定需要 ≥10 对有效样本；低于门槛只报「样本不足」。原始回答保存在本机，报告只截取差异最大的样本。')));

   const runningBody=activeP?h('div',{className:'pb-body'},
    h('div',{className:'pb-sub'},'校验进行中：已完成 '+((activeP.progress&&activeP.progress.completed_pairs)||0)+' / '+(activeP.pair_count||'—')+' 对 · 评审调用 '+((activeP.progress&&activeP.progress.judge_calls)||0)+' 次'),
    h('div',{className:'pb-actions'},h('button',{className:'pb-btn',onClick:()=>cancelParity(activeP.id)},'取消本次校验'))):null;

   const statusSection=pr?section('结论与指标','判定基于配对样本量与 Wilson 置信区间，不只看平均值',null,
    h('div',{className:'pb-body'},
     h('div',{className:'pb-kpis'},
      h('div',{className:'pb-kpi'},h('span',null,'有效配对'),h('b',null,paritySummary?paritySummary.pairs+' / '+pr.pair_count:'—')),
      h('div',{className:'pb-kpi'},h('span',null,'规范化一致'),h('b',null,paritySummary?ratePct(paritySummary.normalized.rate):'—')),
      h('div',{className:'pb-kpi'},h('span',null,'完全一致'),h('b',null,paritySummary?ratePct(paritySummary.exact.rate):'—')),
      h('div',{className:'pb-kpi'},h('span',null,'平均编辑相似度'),h('b',null,paritySummary&&paritySummary.mean_edit!=null?Number(paritySummary.mean_edit).toFixed(3):'—'))),
     h('div',{className:'pb-actions'},
      pr.verdict?chip('一致性：'+verdictLabel(pr.verdict),pr.verdict.level):chip('一致性：—'),
      pr.quality_verdict?chip('质量：'+qualityLabel(pr.quality_verdict),pr.quality_verdict.level):null,
      chip(statusText(pr.status),statusTone(pr.status)),
      chip((pr.prompt_count||0)+' 条提示词 × '+(pr.plan&&pr.plan.repeats||1)+' 次')),
     pr.verdict&&h('div',{className:'pb-sub'},pr.verdict.reason),
     pr.quality_verdict&&h('div',{className:'pb-sub'},pr.quality_verdict.reason),
     paritySummary?table(['指标','A ↔ B','95% 置信区间','说明'],[
      ['完全一致（逐字）',ratePct(paritySummary.exact.rate),intervalText(paritySummary.exact.wilson),'最严格，格式差异也会判否'],
      ['规范化一致',ratePct(paritySummary.normalized.rate),intervalText(paritySummary.normalized.wilson),'忽略大小写、全半角与空白'],
      ['忽略标点与空白',ratePct(paritySummary.tight.rate),intervalText(paritySummary.tight.wilson),'再忽略标点，抓答案本体'],
      ['结构一致',ratePct(paritySummary.structure.rate),intervalText(paritySummary.structure.wilson),'JSON / 代码块 / 拒答 / 列表形状'],
      ['平均编辑相似度',paritySummary.mean_edit==null?'—':Number(paritySummary.mean_edit).toFixed(3),'—','0–1，字符级 Levenshtein'],
      ['平均 3-gram Jaccard',paritySummary.mean_jaccard==null?'—':Number(paritySummary.mean_jaccard).toFixed(3),'—','字面重合度，短中文答案偏严格'],
      ['中位长度比（短/长）',paritySummary.median_length_ratio==null?'—':Number(paritySummary.median_length_ratio).toFixed(3),'—','<1 表示一侧系统性更长'],
      ['平均 completion token 差',paritySummary.token_delta_mean==null?'—':Number(paritySummary.token_delta_mean).toFixed(1),'—','仅服务端返回 usage 时计算'],
      ['平均延迟 A / B',(paritySummary.latency_ms&&paritySummary.latency_ms.a!=null?Math.round(paritySummary.latency_ms.a)+' ms':'—')+' / '+(paritySummary.latency_ms&&paritySummary.latency_ms.b!=null?Math.round(paritySummary.latency_ms.b)+' ms':'—'),'—','非流式一次请求的端到端延迟'],
     ],[1,2]):null,
     qualitySummary&&qualitySummary.gold?h(React.Fragment,null,
      h('h3',{className:'pb-sub'},'金标质量'),
      table(['目标','金标通过','通过率','95% 置信区间','未通过样本'],[
       ['A（基准）',(qualitySummary.gold.a.passed||0)+' / '+(qualitySummary.gold.a.graded||0),ratePct(qualitySummary.gold.a.rate),intervalText(qualitySummary.gold.a.wilson),(qualitySummary.gold.a.failed_ids||[]).join(', ')||'—'],
       ['B（待核对）',(qualitySummary.gold.b.passed||0)+' / '+(qualitySummary.gold.b.graded||0),ratePct(qualitySummary.gold.b.rate),intervalText(qualitySummary.gold.b.wilson),(qualitySummary.gold.b.failed_ids||[]).join(', ')||'—'],
      ],[1,2,3])):null,
     judge?h('div',{className:'pb-sub'},'LLM 评审：'+(judge.calls||0)+' 次调用（有效 '+(judge.judged||0)+' 对）· A 胜 '+(judge.wins_a||0)+' / B 胜 '+(judge.wins_b||0)+' / 平 '+(judge.ties||0)+' · 顺序不一致 '+(judge.inconsistent||0)+' · 评分矛盾 '+(judge.contradictory||0)+' · 平均分 A '+(judge.mean_score_a==null?'—':Number(judge.mean_score_a).toFixed(2))+' / B '+(judge.mean_score_b==null?'—':Number(judge.mean_score_b).toFixed(2))):null,
     h('div',{className:'pb-sub'},'token 来源：A '+JSON.stringify((summary.per_target&&summary.per_target.a&&summary.per_target.a.token_sources)||{})+' · B '+JSON.stringify((summary.per_target&&summary.per_target.b&&summary.per_target.b.token_sources)||{})+' · 失败请求 A '+(summary.per_target&&summary.per_target.a?summary.per_target.a.failures:0)+' / B '+(summary.per_target&&summary.per_target.b?summary.per_target.b.failures:0)))):null;

   const rowsSection=pr?section('逐条配对结果','回答文本只在本地；表格最多显示 50 对',null,
    h('div',{className:'pb-body'},
     rows.length?table(['提示词','重复','顺序','完全一致','规范化','编辑','长度比','A 延迟','B 延迟','金标 A / B','评委'],[
      ...rows.slice(0,50).map(row=>[
       row.prompt_id,
       row.repeat+1,
       row.order==='A-first'?'A→B':'B→A',
       yesNo(row.metrics&&row.metrics.exact),
       yesNo(row.metrics&&row.metrics.normalized),
       row.metrics&&row.metrics.edit!=null?Number(row.metrics.edit).toFixed(3):'—',
       row.metrics&&row.metrics.length_ratio!=null?Number(row.metrics.length_ratio).toFixed(2):'—',
       row.a&&row.a.latency_ms!=null?row.a.latency_ms+' ms':'—',
       row.b&&row.b.latency_ms!=null?row.b.latency_ms+' ms':'—',
       (row.gold_a&&row.gold_a.passed===true?'✔':row.gold_a&&row.gold_a.passed===false?'✘':'—')+' / '+(row.gold_b&&row.gold_b.passed===true?'✔':row.gold_b&&row.gold_b.passed===false?'✘':'—'),
       row.judge&&row.judge.verdict?row.judge.verdict.winner+(row.judge.consistent===false?'（顺序不一致）':''):'—',
      ])], [3,4,5,6,7,8,9,10]):empty('还没有配对结果。'))):null;

   const diffsSection=diffs.length?section('差异最大的样本','按编辑相似度升序；完整原文在导出文件里',null,
    h('div',{className:'pb-body'},...diffs.map(diff=>h('div',{className:'pb-diff',key:diff.prompt_id+'-'+diff.repeat},
     h('div',{className:'pb-diff-head'},
      h('b',null,diff.prompt_id),h('span',{className:'pb-sub'},'编辑 '+(diff.edit==null?'—':Number(diff.edit).toFixed(3))+' · 长度比 '+(diff.length_ratio==null?'—':Number(diff.length_ratio).toFixed(2))+(diff.judge_winner?' · 评委 '+diff.judge_winner:''))),
     h('div',{className:'pb-sub'},'提示词：'+diff.prompt),
     h('div',{className:'pb-diff-block'},h('b',null,'A（基准）'),h('pre',null,diff.answer_a||'（空）')),
     h('div',{className:'pb-diff-block'},h('b',null,'B（待核对）'),h('pre',null,diff.answer_b||'（空）')))))):null;

   const historySection=section('历史校验','同一组目标可重复运行，比较不同时间窗的结论',null,
    h('div',{className:'pb-body'},parityRuns.length?table(['状态','目标 A → B','样本','一致性','质量','时间','操作'],[
     ...parityRuns.slice(0,10).map(run=>[
      chip(statusText(run.status),statusTone(run.status)),
      (run.plan&&run.plan.targets&&run.plan.targets.a?run.plan.targets.a.name:'—')+' → '+(run.plan&&run.plan.targets&&run.plan.targets.b?run.plan.targets.b.name:'—'),
      (run.pair_count||0)+' 对',
      run.verdict?chip(verdictLabel(run.verdict),run.verdict.level):chip('—'),
      run.quality_verdict?chip(qualityLabel(run.quality_verdict),run.quality_verdict.level):chip('—'),
      new Date(run.created_at).toLocaleString(),
      h('div',{className:'pb-actions'},
       h('button',{className:'pb-link',onClick:()=>{setParityRunId(run.id);setParityReportText('')}},'查看'),
       h('button',{className:'pb-link',onClick:()=>showParityReport(run.id)},'报告'),
       h('button',{className:'pb-link',onClick:()=>exportParity(run.id,'md')},'导出'),
       (run.status==='running'||run.status==='cancelling')&&h('button',{className:'pb-link',onClick:()=>cancelParity(run.id)},'取消')),
     ])], [0,2,3,4,6]):empty('还没有一致性校验记录，先在左侧选择两个目标并开始校验。')));

   const reportSection=parityReportText?section('校验报告','Markdown，可直接复制到评审记录',h('button',{className:'pb-link',onClick:()=>setParityReportText('')},'收起'),h('div',{className:'pb-body'},h('pre',{className:'pb-report'},parityReportText))):null;

   const limitsSection=section('口径与局限','必读：这是行为一致性证据，不是权重证明',null,
    h('div',{className:'pb-body pb-defs'},
     h('div',null,h('b',null,'采样一致'),'两端点必须使用同一提示词集、temperature=0、相同 seed、相同 max_tokens；否则差异里混入随机性。'),
     h('div',null,h('b',null,'判定门槛'),'至少 10 对有效样本；忽略标点与空白后一致率 ≥95% 且平均编辑相似度 ≥0.95 判 PASS；<85% 判 FAIL；中间区间判 WARN 并要求人工看差异样本。'),
     h('div',null,h('b',null,'质量评分'),'内置语料含少量可判定金标（算术、JSON、提取、拒答等）；金标不足时只说 INSUFFICIENT，不把 2–3 条通过率当质量结论。'),
     h('div',null,h('b',null,'LLM 评审'),'评审会额外消耗 token，且评委自身有偏好；默认互换 A/B 顺序各评一次，顺序结论不一致的样本不计入胜负。'),
     h('div',null,h('b',null,'不能证明什么'),'行为一致不代表权重、量化版本、路由或缓存策略相同；反过来说，行为不一致也只能说明至少有一层不同，不能定位原因。')));

   return h(React.Fragment,null,
    heading('CONSISTENCY & QUALITY','一致性校验 / 版本对齐','同一提示词集分别打 A（基准）与 B（待核对）两个已配置目标，比对回答文本并用金标与评审打分；行为一致是证据，不是权重证明。',
     h('div',{className:'pb-actions'},
      activeP&&h('button',{className:'pb-btn',onClick:()=>cancelParity(activeP.id)},'取消校验'),
      pr&&h('button',{className:'pb-btn',onClick:()=>showParityReport(pr.id)},'生成报告'),
      pr&&h('button',{className:'pb-btn',onClick:()=>exportParity(pr.id,'md')},'导出 MD'),
      pr&&h('button',{className:'pb-btn',onClick:()=>exportParity(pr.id,'csv')},'导出 CSV'),
      h('button',{className:'pb-btn primary',onClick:startParity,disabled:busy||targets.length<2},targets.length<2?'需先配置两个目标':'开始校验'))),
    runningBody,
    formSection,
    statusSection,
    rowsSection,
    diffsSection,
    reportSection,
    historySection,
    limitsSection);
  }

  function planPage(){
   const planCatalog=(snapshot&&snapshot.plans)||[];
   const dimMeta=(snapshot&&snapshot.dimensions)||{};
   const planRuns=(snapshot&&snapshot.plan_runs)||[];
   const active=planRuns.find(r=>r.status==='running'||r.status==='cancelling');
   const detail=planDetail;
   const summary=detail&&detail.summary;
   const selectedPlan=planCatalog.find(p=>p.id===plans.plan_id)||null;
   const usingB = Boolean(plans.target_b);
   const setF=(key)=>(event)=>{const value=event.target.type==='checkbox'?event.target.checked:event.target.value;setPlans(current=>({...current,[key]:value}))};
   const field=(text,control,wide)=>h('label',{className:wide?'pb-wide':''},h('span',null,text),control);
   const statusLabel=value=>({PASS:'通过',WARN:'警告',FAIL:'不通过',INSUFFICIENT:'样本不足',DIFFERENT:'存在显著差异',NO_DIFFERENCE:'未发现显著差异',SUSPECT:'有嫌疑',INCONCLUSIVE:'不确定',NO_EVIDENCE:'未发现证据'}[value]||value||'—');
   const tone=value=>({PASS:'ok',WARN:'warn',FAIL:'bad',DIFFERENT:'warn',NO_DIFFERENCE:'ok',SUSPECT:'bad',INCONCLUSIVE:'warn',NO_EVIDENCE:'ok'}[value]||'');
   const money=(value,currency)=>value==null||!Number.isFinite(Number(value))?'—':(currency||'')+' '+Number(value).toFixed(4);
   const rate=value=>value==null||!Number.isFinite(Number(value))?'—':(Number(value)*100).toFixed(1)+'%';
   const interval=value=>!value||value.low==null?'—':rate(value.low)+'–'+rate(value.high);
   const toggleDimension=(dimension)=>setPlans(current=>{const list=current.dimensions.includes(dimension)?current.dimensions.filter(x=>x!==dimension):[...current.dimensions,dimension];return {...current,dimensions:list}});
   const choosePlan=(plan)=>{
    if(plan.engine==='parity'){setPage('parity');return}
    if(plan.engine==='bench'){setPage('bench');return}
    setPlans(current=>({...current,mode:'standard',plan_id:plan.id,
     temperature:plan.default_temperature!=null&&Number(current.temperature)===0?plan.default_temperature:current.temperature}));
   };
   const selectPlanCard=(plan)=>h('div',{key:plan.id,className:'pb-plan-card'+(plans.mode==='standard'&&plans.plan_id===plan.id?' selected':''),role:'button',tabIndex:0,'aria-pressed':plans.mode==='standard'&&plans.plan_id===plan.id,onClick:()=>choosePlan(plan),onKeyDown:event=>{if(event.key==='Enter'||event.key===' ')choosePlan(plan)}},
    h('div',{className:'pb-plan-head'},h('b',null,plan.title),plans.mode==='standard'&&plans.plan_id===plan.id?h('span',{className:'pb-chip ok'},'已选'):h('span',{className:'pb-chip'+(plan.engine==='plan'?' live':'')},plan.engine==='plan'?'可直接运行':plan.engine==='parity'?'去一致性页':'去压测页')),
    h('p',{className:'pb-sub'},plan.emphasis),
    h('div',{className:'pb-chips'},
     (plan.dimensions||[]).map(dimension=>h('span',{key:dimension,className:'pb-chip'},dimMeta[dimension]?dimMeta[dimension].title:(DIM_LABELS[dimension]||dimension))),
     plan.requires_b?h('span',{className:'pb-chip pb-chip-warn'},'需目标 A+B'):plan.recommends_b?h('span',{className:'pb-chip'},'建议 A+B'):null,
     plan.default_temperature!=null?h('span',{className:'pb-chip'},'temperature '+plan.default_temperature):null,
     plan.judge&&plan.judge!=='off'?h('span',{className:'pb-chip'},'评审'+ (plan.judge==='recommended'?'（建议）':'（可选）')):null,
     plan.item_count?h('span',{className:'pb-chip'},plan.item_count+' 题'):null,
     plan.est_minutes?h('span',{className:'pb-chip'},plan.est_minutes):null),
    h('div',{className:'pb-sub'},'依据：'+(plan.references||[]).join('；')),
    plan.tips?h('div',{className:'pb-sub'},'提示：'+plan.tips):null);

   const cardSection=section('标准方案','按侧重选择；标注「可直接运行」的方案在本页执行，一致性与性能方案跳转到对应页面',null,
    h('div',{className:'pb-body'},
     h('div',{className:'pb-plan-cards'},...planCatalog.map(selectPlanCard)),
     h('div',{className:'pb-actions'},
      h('button',{className:'pb-btn',onClick:()=>setPlans(current=>({...current,mode:'custom'}))},'改为定制方案'),
      plans.mode==='custom'?chip('当前：定制方案','ok'):chip('当前：'+(selectedPlan?selectedPlan.title:plans.plan_id)))));

   const customSection=plans.mode==='custom'?h('div',{className:'pb-body'},
    h('div',{className:'pb-sub'},'勾选维度后，仍可用下方参数控制样本量与评审；长上下文长度按字符近似 token。'),
    h('div',{className:'pb-plan-dims'},...['knowledge','reasoning','code','instruction','long_context','safety','stability','usage'].map(dimension=>h('label',{key:dimension,className:'pb-check-row'},
     h('input',{type:'checkbox',checked:plans.dimensions.includes(dimension),onChange:()=>toggleDimension(dimension)}),
     h('span',null,dimMeta[dimension]?dimMeta[dimension].title:(DIM_LABELS[dimension]||dimension)),
     h('span',{className:'pb-sub'},dimMeta[dimension]?dimMeta[dimension].hint:'')))),
    field('语料来源',h('select',{value:plans.dataset_source,onChange:setF('dataset_source')},h('option',{value:'builtin'},'内置题库（按维度）'),h('option',{value:'file'},'本机 JSONL（自定义语料，含金标字段）'))),
    plans.dataset_source==='file'?field('JSONL 绝对路径',h('input',{value:plans.file_path,placeholder:'/Users/you/quality-items.jsonl',onChange:setF('file_path')}),true):null):null;

   const needsLongContext=plans.mode==='custom'?plans.dimensions.includes('long_context'):Boolean(selectedPlan&&selectedPlan.dimensions.includes('long_context'));
   const formSection=section('方案配置',plans.mode==='custom'?'定制方案：按勾选维度拼装':'标准方案参数：默认值已按可复现口径设置',null,
    h('div',{className:'pb-body pb-form'},
     field('目标 A（待测端点）',h('select',{value:plans.target_a,onChange:setF('target_a')},h('option',{value:''},'— 请选择 —'),...targets.map(t=>h('option',{value:t.id,key:t.id},t.name+' · '+t.model)))),
     field('目标 B（参考端点，可选）',h('select',{value:plans.target_b,onChange:setF('target_b')},h('option',{value:''},'— 不比较，只测 A —'),...targets.filter(t=>t.id!==plans.target_a).map(t=>h('option',{value:t.id,key:t.id},t.name+' · '+t.model)))),
     field('每维度题目数（0=全部）',h('input',{type:'number',min:'0',max:'40',value:plans.per_dimension,onChange:setF('per_dimension')})),
     field('重复次数（稳定性 / 混推理）',h('input',{type:'number',min:'1',max:'5',value:plans.repeats,onChange:setF('repeats')})),
     field('max_tokens',h('input',{type:'number',min:'16',max:'2048',value:plans.max_tokens,onChange:setF('max_tokens')})),
     field('temperature（质量抽查建议 0；混推理审计建议 ≥0.7）',h('input',{type:'number',min:'0',max:'2',step:'0.1',value:plans.temperature,onChange:setF('temperature')})),
     field('seed（固定采样）',h('input',{type:'number',min:'0',value:plans.seed,onChange:setF('seed')})),
     needsLongContext?field('长上下文长度（字符，逗号分隔）',h('input',{value:plans.long_context_lengths,onChange:setF('long_context_lengths')})):null,
     needsLongContext?field('埋点位置',h('input',{value:plans.long_context_depths,placeholder:'front,middle,end',onChange:setF('long_context_depths')})):null,
     h('label',{className:'pb-check'},h('input',{type:'checkbox',checked:Boolean(plans.judge_enabled),onChange:setF('judge_enabled')}),h('span',null,'启用 LLM 评审（额外 token 费用）')),
     field('评审目标',h('select',{value:plans.judge_target_id,onChange:setF('judge_target_id'),disabled:!plans.judge_enabled},h('option',{value:''},'— 未选择 —'),...targets.map(t=>h('option',{value:t.id,key:t.id},t.name+' · '+t.model)))),
     field('评审评分标准（可选）',h('input',{value:plans.judge_rubric,placeholder:'例如：正确性优先，其次格式与完整性',onChange:setF('judge_rubric')}),true),
     customSection?h('div',{className:'pb-wide'},customSection):null,
     h('label',{className:'pb-check pb-wide'},h('input',{type:'checkbox',checked:plans.pricing_mode==='batch',onChange:e=>setF('pricing_mode')&&setPlans(current=>({...current,pricing_mode:e.target.checked?'batch':'standard'}))}),h('span',null,'按批量任务计价（应用价目表的批量折扣；不勾选按标准价）')),
     selectedPlan&&selectedPlan.requires_b&&!usingB?notice('该方案需要目标 B（官方参考端点）。没有 B 的同一提示词 usage 作参照，token 虚高只能写 INSUFFICIENT，不能下结论。'):null,
     h('div',{className:'pb-wide pb-sub'},'目标 A 价目表：'+(pricingOf(targets.find(t=>t.id===plans.target_a))?'已配置（'+pricingOf(targets.find(t=>t.id===plans.target_a)).currency+' / 每百万 token）':'未配置 → 只能测质量，不能算成本、不能做账面复核')+(usingB?'；目标 B：'+(pricingOf(targets.find(t=>t.id===plans.target_b))?'已配置':'未配置（成本只算 A）'):'')),
     selectedPlan&&selectedPlan.id==='mix-audit'?h('div',{className:'pb-wide pb-sub'},'混推理审计会把重复次数至少提高到 3 次，并在 temperature=0 时自动改用 0.7；这是为了区分路由混合与确定性输出。'):null,
     h('div',{className:'pb-wide pb-sub'},selectedPlan?('预计题目：'+(selectedPlan.item_count||'—')+' 题 · 请求量约 '+(selectedPlan.est_requests||'—')+' 次（目标 A'+(usingB?' + B':'')+'）· '+(selectedPlan.est_minutes||'')).replace('目标 A + B','目标 A + B，请求翻倍'):'定制方案的题目数由维度与每维度题目数决定，开始后以服务端计划为准。'),
     h('div',{className:'pb-wide pb-sub'},'判定是程序化的：金标、JSON/字数/大小写/顺序等可验证约束、拒答启发式、长上下文检索命中；评审只是附加信号。回答原文仅存本机。')));

   const runningBody=active?h('div',{className:'pb-body'},
    h('div',{className:'pb-sub'},'方案运行中：已完成 '+((active.progress&&active.progress.completed_items)||0)+' / '+(active.item_count||'—')+' 题 · 请求 '+((active.progress&&active.progress.requests)||0)+' 次 · 评审 '+((active.progress&&active.progress.judge_calls)||0)+' 次'),
    h('div',{className:'pb-actions'},h('button',{className:'pb-btn',onClick:()=>cancelPlan(active.id)},'取消本次方案'))):null;

   const dimensionTable=summary&&summary.dimensions?(()=>{
    const keys=usingB?['a','b']:['a'];
    const headers=['维度'];
    keys.forEach(key=>{headers.push('目标 '+key.toUpperCase()+' 通过');headers.push('目标 '+key.toUpperCase()+' 判定')});
    const rows=Object.keys(summary.dimensions).map(dimension=>{
     const bucket=summary.dimensions[dimension];
     const row=[(dimMeta[dimension]&&dimMeta[dimension].title)||DIM_LABELS[dimension]||dimension];
     keys.forEach(key=>{const stats=bucket.targets&&bucket.targets[key];row.push(stats?((stats.passed||0)+'/'+(stats.graded||0)+' · '+rate(stats.rate)):'—')});
     keys.forEach(key=>{const verdict=summary.verdicts&&summary.verdicts.by_dimension&&summary.verdicts.by_dimension[dimension]&&summary.verdicts.by_dimension[dimension][key];row.push(verdict?chip(statusLabel(verdict.status),tone(verdict.status)):'—')});
     return row;
    });
    return table(headers,rows,keys.flatMap((key,index)=>[1+index*2]));
   })():null;

   const judgeLine=summary&&summary.judge?h('div',{className:'pb-sub'},'LLM 评审：A '+((summary.judge.a&&summary.judge.a.calls)||0)+' 次调用，有效 '+((summary.judge.a&&summary.judge.a.scored)||0)+' 条，平均分 '+(summary.judge.a&&summary.judge.a.mean_score!=null?Number(summary.judge.a.mean_score).toFixed(2):'—')+(usingB?' · B '+((summary.judge.b&&summary.judge.b.calls)||0)+' 次，平均分 '+(summary.judge.b&&summary.judge.b.mean_score!=null?Number(summary.judge.b.mean_score).toFixed(2):'—'):'')):null;

   const kpis = h('div',{className:'pb-kpis'},
    h('div',{className:'pb-kpi'},h('span',null,'目标 A 总判定'),h('b',null,statusLabel(summary&&summary.verdicts&&summary.verdicts.overall&&summary.verdicts.overall.a&&summary.verdicts.overall.a.status))),
    h('div',{className:'pb-kpi'},h('span',null,'可判定题 A'),h('b',null,summary&&summary.verdicts&&summary.verdicts.overall&&summary.verdicts.overall.a?String(summary.verdicts.overall.a.totalGraded):'—')),
    usingB?h('div',{className:'pb-kpi'},h('span',null,'目标 B 总判定'),h('b',null,statusLabel(summary&&summary.verdicts&&summary.verdicts.overall&&summary.verdicts.overall.b&&summary.verdicts.overall.b.status))):null,
    usingB?h('div',{className:'pb-kpi'},h('span',null,'A/B 比较'),h('b',null,statusLabel(summary&&summary.comparison&&summary.comparison.status))):null);
   const statusChips = h('div',{className:'pb-actions'},
    chip('方案：'+((detail&&detail.plan&&(detail.plan.title||detail.plan.standard_title))||'—')),
    chip(statusText(detail?detail.status:''),statusTone(detail?detail.status:'')),
    chip(((detail&&detail.plan&&detail.plan.item_count)||0)+' 题 · 请求 '+(summary&&summary.requests||0)+' 次 · 失败 '+(summary&&summary.failed_requests||0)));
   const statusSection=detail?section('结论与分维度结果','总判定取最差维度；样本不足的维度不参与总判定',null,
    h('div',{className:'pb-body'},kpis,statusChips,dimensionTable,judgeLine)):null;

   const failed=summary&&summary.failed_items||[];
   const failedSection=failed.length?section('未通过样本','最多显示 20 条；完整回答只在本机 ndjson 与人工导出中',null,
    h('div',{className:'pb-body'},...failed.map((item,index)=>h('div',{className:'pb-plan-failed',key:String(item.target||'a')+item.item_id+index},
     h('div',{className:'pb-plan-failed-head'},chip(String(item.target||'a').toUpperCase(),'bad'),h('b',null,item.item_id),h('span',{className:'pb-sub'},(dimMeta[item.dimension]&&dimMeta[item.dimension].title)||DIM_LABELS[item.dimension]||item.dimension)),
     h('div',{className:'pb-sub'},'题目：'+item.prompt),
     h('pre',null,item.answer||'（空）'),
     h('div',{className:'pb-sub'},'未通过项：'+(item.checks||[]).join('、')))))):null;

   const billing=summary&&summary.billing_audit;
   const billingSection=billing?section('计费审计 · token 与缓存对账',billing.reason||'A/B 同题 usage 对比',null,
    h('div',{className:'pb-body'},
     h('div',{className:'pb-kpis'},
      h('div',{className:'pb-kpi'},h('span',null,'判定'),h('b',null,statusLabel(billing.status))),
      h('div',{className:'pb-kpi'},h('span',null,'A/B 可用配对'),h('b',null,String(billing.pairs||0)+' / '+(billing.sample_size||0)+' 道')),
      h('div',{className:'pb-kpi'},h('span',null,'输入比值中位'),h('b',null,billing.prompt_ratio_median==null?'—':String(billing.prompt_ratio_median))),
      h('div',{className:'pb-kpi'},h('span',null,'输出比值中位'),h('b',null,billing.completion_ratio_median==null?'—':String(billing.completion_ratio_median)))),
     h('div',{className:'pb-actions'},
      chip('缓存命中 A：'+((billing.cache&&billing.cache.a&&billing.cache.a.hit_rate)!=null?(billing.cache.a.hit_rate*100).toFixed(0)+'%':'—'),billing.cache&&billing.cache.suspect?'bad':''),
      chip('缓存命中 B：'+((billing.cache&&billing.cache.b&&billing.cache.b.hit_rate)!=null?(billing.cache.b.hit_rate*100).toFixed(0)+'%':'—')),
      chip('输入虚高配对 '+(billing.prompt_inflated_pairs||0)),
      chip('输出虚高配对 '+(billing.completion_inflated_pairs||0))),
     billing.cost&&billing.cost.available?h('div',{className:'pb-sub'},'账面成本：A 实际 '+money(billing.cost.actual,billing.cost.currency)+'；同任务按 A 价目表、B usage 计算 '+money(billing.cost.expected_at_a_prices,billing.cost.currency)+'；比值 '+(billing.cost.ratio==null?'—':billing.cost.ratio)+(billing.cost.batch?'（批量价）':'（标准价）')):h('div',{className:'pb-sub'},'账面成本不可算：目标 A 未配置价目表，或成功响应缺 usage。'),
     billing.top_pairs&&billing.top_pairs.length?table(['题目','尝试','输入 A/B','输出 A/B','缓存 A/B'],[
      ...billing.top_pairs.map(pair=>[pair.item_id,String(pair.attempt+1),pair.a_prompt+' / '+pair.b_prompt,pair.a_completion+' / '+pair.b_completion,(pair.a_cached||0)+' / '+(pair.b_cached||0)])],[2,3,4]):null,
     h('div',{className:'pb-sub'},'注意：'+(billing.caveats||[]).join('；')))):null;

   const routing=summary&&summary.routing_audit;
   const routingSection=routing?section('混推理审计 · 路由一致性',routing.reason||'重复采样的强弱题对照',null,
    h('div',{className:'pb-body'},
     h('div',{className:'pb-kpis'},
      h('div',{className:'pb-kpi'},h('span',null,'判定'),h('b',null,statusLabel(routing.status))),
      h('div',{className:'pb-kpi'},h('span',null,'A 强题混合'),h('b',null,String(routing.a&&routing.a.strong_mixed||0)+' 道')),
      h('div',{className:'pb-kpi'},h('span',null,'A 对照题通过率'),h('b',null,routing.a&&routing.a.control_pass_rate!=null?rate(routing.a.control_pass_rate):'—')),
      h('div',{className:'pb-kpi'},h('span',null,'采样温度'),h('b',null,String(routing.temperature)))),
     h('div',{className:'pb-actions'},chip('重复 '+(routing.repeats||0)+' 次'),chip('可判样本 '+(routing.a&&routing.a.total_graded||0)),chip('A model：'+((routing.a&&routing.a.models&&routing.a.models.join('、'))||'未返回')),routing.b?chip('B 强题混合 '+(routing.b.strong_mixed||0)):null),
     routing.a&&routing.a.probes&&routing.a.probes.length?table(['探针','类型','通过对/可判','混合','通过率','延迟 CV','输出长度范围'],[
      ...routing.a.probes.map(probe=>[probe.item_id,probe.strength==='strong'?'强题':'对照',probe.passed+' / '+probe.graded,probe.mixed?chip('是','bad'):chip('否',''),probe.pass_rate==null?'—':rate(probe.pass_rate),probe.latency_cv==null?'—':String(probe.latency_cv),probe.output_chars_min==null?'—':probe.output_chars_min+'–'+probe.output_chars_max])],[2,3,4,5,6]):null,
     h('div',{className:'pb-sub'},'注意：'+(routing.caveats||[]).join('；')))):null;

   const costs=summary&&summary.costs;
   const costSection=costs?section('成本与推理性价比','账面成本 = 服务端上报 usage × 已录入价目表；这不是厂商账单，usage 虚高会同步放大成本',null,
    h('div',{className:'pb-body'},
     table(['目标','币种','总账面成本','每请求','每可判定题','每通过题','通过题/元'],[
      ...(usingB?['a','b']:['a']).map(key=>{const cost=costs[key];if(!cost)return [key.toUpperCase(),'—','—','—','—','—','—'];if(!cost.available)return [key.toUpperCase(),'—','—','—','—','—',cost.reason||'不可计算'];return [key.toUpperCase(),cost.currency,money(cost.total,cost.currency),money(cost.cost_per_request,cost.currency),cost.cost_per_graded_item==null?'—':money(cost.cost_per_graded_item,cost.currency),cost.cost_per_passed_item==null?'—':money(cost.cost_per_passed_item,cost.currency),cost.passed_per_currency==null?'—':String(cost.passed_per_currency)]})],[2,3,4,5,6]),
     h('div',{className:'pb-sub'},'计价模式：'+(summary.pricing_mode==='batch'?'批量任务价（已应用批量折扣）':'标准价')+'。每通过题成本只对本次题库与参数有效；样本不足时不要用单点比值做采购决策。'))):null;

   const usage=summary&&summary.usage;
   const usageSection=usage?section('用量账本与指纹','无官方 tokenizer：只能发现缺失或离谱的用量，不能精确对账',null,
    h('div',{className:'pb-body'},
     h('div',{className:'pb-kpis'},
      h('div',{className:'pb-kpi'},h('span',null,'A usage 返回'),h('b',null,(usage.a&&usage.a.usage_reported||0)+' / '+(usage.a&&usage.a.responses||0))),
      h('div',{className:'pb-kpi'},h('span',null,'A 估算比值中位'),h('b',null,usage.a&&usage.a.completion_ratio_median!=null?String(usage.a.completion_ratio_median):'—')),
      h('div',{className:'pb-kpi'},h('span',null,'A 缓存命中响应'),h('b',null,usage.a?String(usage.a.cached_responses||0):'—')),
      h('div',{className:'pb-kpi'},h('span',null,'A 响应 model'),h('b',null,usage.a&&usage.a.reported_models&&usage.a.reported_models.length?usage.a.reported_models.join('、'):'未返回'))),
     h('div',{className:'pb-sub'},'A system_fingerprint：'+(usage.a&&usage.a.system_fingerprints&&usage.a.system_fingerprints.length?usage.a.system_fingerprints.join('、'):'未返回')+(usingB?' · B system_fingerprint：'+(usage.b&&usage.b.system_fingerprints&&usage.b.system_fingerprints.length?usage.b.system_fingerprints.join('、'):'未返回'):'')),
     h('div',{className:'pb-sub'},(usage.a&&usage.a.note)||''))):null;

   const reportSection=planReportText?section('方案报告','Markdown，可直接复制到评审记录',h('button',{className:'pb-link',onClick:()=>setPlanReportText('')},'收起'),h('div',{className:'pb-body'},h('pre',{className:'pb-report'},planReportText))):null;

   const historySection=section('历史方案','同一目标可重复跑，比较不同时间窗的抽查结论',null,
    h('div',{className:'pb-body'},planRuns.length?table(['状态','方案','目标','题目','A 判定','B 判定','时间','操作'],[
     ...planRuns.slice(0,10).map(run=>[
      chip(statusText(run.status),statusTone(run.status)),
      run.plan&&(run.plan.title||run.plan.standard_title)||run.plan&&run.plan.plan_id||'—',
      (run.plan&&run.plan.targets&&run.plan.targets.a?run.plan.targets.a.name:'—')+(run.plan&&run.plan.targets&&run.plan.targets.b?' → '+run.plan.targets.b.name:''),
      (run.item_count||0)+' 题',
      run.verdict?chip(statusLabel(run.verdict),tone(run.verdict)):chip('—'),
      run.verdict_b?chip(statusLabel(run.verdict_b),tone(run.verdict_b)):chip('—'),
      new Date(run.created_at).toLocaleString(),
      h('div',{className:'pb-actions'},
       h('button',{className:'pb-link',onClick:()=>{setPlanRunId(run.id);setPlanReportText('')}},'查看'),
       h('button',{className:'pb-link',onClick:()=>showPlanReport(run.id)},'报告'),
       h('button',{className:'pb-link',onClick:()=>exportPlan(run.id,'md')},'导出 MD'),
       h('button',{className:'pb-link',onClick:()=>exportPlan(run.id,'csv')},'导出 CSV'),
       (run.status==='running'||run.status==='cancelling')&&h('button',{className:'pb-link',onClick:()=>cancelPlan(run.id)},'取消')),
     ])],[0,2,3,4,5,7]):empty('还没有测试方案运行。先选一个标准方案或定制维度。')));

   const limitsSection=section('方法依据与局限','必读：抽查不等于官方 benchmark，行为证据不等于权重证明',null,
    h('div',{className:'pb-body pb-defs'},
     h('div',null,h('b',null,'方案从哪来'),'参考 HELM 的多维评测骨架、EvalScope/lm-evaluation-harness 的可复现参数、IFEval 的可验证指令、RULER 的长上下文检索、HarmBench 的拒答测试与 XSTest 的过度拒答检查；题目为本工作台自建小样本。'),
     h('div',null,h('b',null,'判定门槛'),'每个维度至少 3 道可判定题、总计至少 10 道；单维度通过率 ≥90% 判 PASS，≥70% 判 WARN，否则 FAIL；样本不足一律 INSUFFICIENT。'),
     h('div',null,h('b',null,'不能证明什么'),'不能证明模型权重、量化版本、路由或缓存策略相同；不能外推为官方分数；temperature>0 时输出随机性会污染判定。'),
     h('div',null,h('b',null,'评审的代价'),'启用 LLM 评审会额外消耗 token，且评委存在长度与风格偏好；评审只在有确定判据的题上做补充，不替代金标。'),
     h('div',null,h('b',null,'隐私'),'题目与回答原文保存在本机 runs/<id>/plan.ndjson（0600）；列表与报告只带摘要，完整导出需人工点击。')));

   return h(React.Fragment,null,
    heading('MODEL QUALITY PLANS','测试方案 · 供应商模型质量抽查','选标准方案或定制维度，按可复现参数对目标 A（可选 B 参考）跑一组可判分的抽查题；结论只能写「本次题库下是否发现明显差异」。',
     h('div',{className:'pb-actions'},
      active&&h('button',{className:'pb-btn',onClick:()=>cancelPlan(active.id)},'取消方案'),
      detail&&h('button',{className:'pb-btn',onClick:()=>showPlanReport(detail.id)},'生成报告'),
      detail&&h('button',{className:'pb-btn',onClick:()=>exportPlan(detail.id,'md')},'导出 MD'),
      detail&&h('button',{className:'pb-btn',onClick:()=>exportPlan(detail.id,'csv')},'导出 CSV'),
      h('button',{className:'pb-btn primary',onClick:startPlan,disabled:busy||!targets.length||!plans.target_a},targets.length?'开始方案':'需先配置目标'))),
    runningBody,
    cardSection,
    formSection,
    statusSection,
    billingSection,
    routingSection,
    costSection,
    failedSection,
    usageSection,
    reportSection,
    historySection,
    limitsSection);
  }

  function comparePage(){
   const selected=compareIds.map(id=>runs.find(r=>r.id===id)).filter(Boolean);
   return h(React.Fragment,null,
    heading('COMPARE','运行对比','同一端点不同时间、或不同供应商之间对比；先保证口径与负载一致。',
     h('div',{className:'pb-actions'},h('span',{className:'pb-chip'},'已选 '+compareIds.length+' 个'),h('button',{className:'pb-btn',onClick:()=>setCompareIds([])},'清空'))),
    h('div',{className:'pb-grid-2'},
     section('选择运行','最多 6 个',null,
      h('div',{className:'pb-body pb-check-list'},runs.length?runs.slice(0,20).map(r=>h('label',{key:r.id,className:'pb-check-row'},
       h('input',{type:'checkbox',checked:compareIds.includes(r.id),onChange:()=>toggleCompare(r.id)}),
       h('span',null,(r.target&&r.target.name||'—')+' · '+shortId(r.id)),
       h('span',{className:'pb-sub'},new Date(r.created_at).toLocaleString()+' · '+(r.plan&&r.plan.list||[]).join('/')))):empty('暂无运行记录。'))),
     section('对比结果','使用各运行末档指标',null,
      h('div',{className:'pb-body'},compareData?table(['运行','目标 / 模型','模式','档位','RPS','TTFT P99','输出 tok/s','输出 tok/min','成功率','SLO 边界'],
       compareData.runs.map(run=>{
        const last=run.rounds[run.rounds.length-1];
        const summary=last&&last.summary;
        const ttftP99=last&&last.percentiles?(last.percentiles.columns['TTFT (ms)'][last.percentiles.percentiles.indexOf('99%')]):null;
        return [shortId(run.id),h('div',null,h('div',null,run.target&&run.target.name||'—'),h('div',{className:'pb-sub'},run.target&&run.target.model||'')),run.plan&&run.plan.mode==='open'?'开环':'闭环',(run.plan&&run.plan.list||[]).join(' / '),summary?fmtNum(summary.qps,2):'—',fmtMs(ttftP99),summary?fmtNum(summary.output_token_throughput):'—',summary?fmtInt(summary.output_tokens_per_minute):'—',summary?fmtPct(summary.success_rate):'—',run.analysis&&run.analysis.slo?String(run.analysis.slo.max_within_slo):'—']
       }),[4,5,6,7,8,9]):(selected.length?h('div',{className:'pb-sub'},'正在加载对比…'):empty('勾选左侧运行后显示对比。'))))));
  }

  const content=page==='overview'?overview():page==='targets'?targetsPage():page==='bench'?benchPage():page==='plans'?planPage():page==='parity'?parityPage():page==='results'?resultsPage():comparePage();
  return h('div',{className:'pb-root',ref:rootRef},
   h('header',{'data-window-drag':true},
    h('div',{className:'pb-brand'},h('span',{className:'pb-mark'},'◉'),'API 质量工作台'),
    h('span',{className:'pb-tag'},'本地压测 · 质量抽查 · 数据不外传'),
    h('span',{className:'pb-flex'}),
    h('button',{className:'pb-btn',onClick:()=>setChatOpen(v=>!v),'aria-expanded':chatOpen,'aria-label':chatOpen?'收起右侧对话':'打开右侧对话'},chatOpen?'收起对话 →':'← 打开对话'),
    h('button',{className:'pb-btn',onClick:()=>ask('请先调用 llm_perf_workbench 的 context 读取当前工作台的目标与最近运行，然后帮我解释最新一次压测的 TTFT、P99 与 SLO 边界，并指出哪些结论还不能下。'),disabled:false},owned?'在 Chat 里分析 ↗':'创建工作台会话 ↗')),
   h('nav',{className:'pb-toolbar','aria-label':'大模型 API 质量工作台导航'},
    ...PAGES.map(([id,title])=>h('button',{key:id,className:page===id?'active':'',onClick:()=>setPage(id),disabled:busy},title))),
   h('div',{className:'pb-context'},
    h('span',null,owned?'当前会话已绑定此工作台 · 状态自动同步':'未绑定工作台会话 · 可浏览与配置，Chat 联动需先创建会话'),
    h('span',null,(snapshot&&snapshot.targets&&snapshot.targets.length||0)+' 个目标 · '+(runs.length||0)+' 次运行 · 版本 '+(snapshot&&snapshot.version||'1.3.2'))),
   h('div',{className:'pb-scroll'},
    toast&&h('div',{className:'pb-toast',role:'status'},toast,h('button',{className:'pb-link',onClick:()=>setToast('')},'关闭')),
    error&&h('div',{className:'pb-error',role:'status'},error,h('button',{className:'pb-link',onClick:()=>setError('')},'关闭')),
    !snapshot?h('div',{className:'pb-loading'},'正在读取本机目标与运行记录…'):content),
   h('div',{className:'pb-foot'},
    h('span',null,'API Key 只存本机数据目录 · 报告不含密钥 · 结果为测量值，不是服务端 SLA 承诺 · 回答文本仅存本机'),
    h('span',null,'口径对齐 EvalScope / vLLM bench')));
 }

 ctx.effect(()=>ctx.desktopWorkbenches.register({
  title:'API 质量台',
  panelTitle:'大模型 API 服务质量检测',
  repository:'https://github.com/caisiyang123/llm-api-perf-workbench',
  description:'本地检测大模型 API：TTFT、TPOT、RPS、输出 tok/s 与 tok/min、并发曲线、P99 与 SLO 边界；标准/定制测试方案抽查供应商模型质量，双端点一致性与版本对齐，结果可导出',
  category:'研发效能',
  layout:{businessSide:'left',businessWidth:.66}
 },Panel));
}
return {apply,inject:['desktopWorkbenches','uiSession','uiWorkspace']};
}});