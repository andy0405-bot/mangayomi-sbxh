/*
 * Mangayomi experimental JS extension: sbxh9 / manhwa
 * Based solely on user-supplied static HTML snapshots (2026-11-20).
 * UNVERIFIED against live site. The reader virtualizes 20 pages but HTML contains 2.
 * No bypass of access controls, no copying cookies or credentials.
 */
const mangayomiSources = [{
  name: "SBXH9 만화 (실험)", id: 2841905963,
  baseUrl: "https://sbxh9.com", lang: "ko", typeSource: "single",
  iconUrl: "https://sbxh9.com/favicon.ico", dateFormat: "", dateFormatLocale: "ko_KR",
  isNsfw: true, hasCloudflare: true, sourceCodeUrl: "",
  apiUrl: "", version: "0.1.0", isManga: true, itemType: 0,
  isFullData: false, appMinVerReq: "0.5.0", additionalParams: "",
  sourceCodeLanguage: 1, notes: "Offline-HTML prototype; live access and full chapter pages not verified"
}];

class DefaultExtension extends MProvider {
  constructor() { super(); this.client = new Client(); }
  get base() { return (this.source && this.source.baseUrl) || "https://sbxh9.com"; }
  absolute(href) {
    if (!href) return "";
    if (/^https?:\/\//i.test(href)) return href;
    if (href.indexOf("//") === 0) return "https:" + href;
    return this.base + (href.charAt(0) === "/" ? href : "/" + href);
  }
  path(url) {
    return url.replace(/^https?:\/\/[^/]+/i, "") || "/";
  }
  async doc(path) {
    var url = this.absolute(path);
    var response = await this.client.get(url, {
      "User-Agent": "Mozilla/5.0 (compatible; Mangayomi)",
      "Referer": this.base + "/"
    });
    var html = response.body || "";
    if (!html || /(?:403 Forbidden|Access Denied|개발자 도구 차단)/i.test(html.substring(0, 1000))) {
      throw new Error("사이트 응답이 차단됐거나 비어 있음. 브라우저 HTML만으로 실접속은 확인되지 않음.");
    }
    return new Document(html);
  }
  text(el) { return el ? String(el.text || "").trim() : ""; }
  attr(el, key) { return el ? String(el.attr(key) || "") : ""; }
  async listing(path, selector) {
    var d = await this.doc(path);
    var cards = d.select(selector);
    var list = [], seen = {};
    for (var i=0; i<cards.length; i++) {
      var card = cards[i];
      var a = card.selectFirst("a.upd-allbtn") || card.selectFirst("a.upd-card-main");
      var href = this.attr(a, "href");
      // Latest cards link directly to chapter; derive series path from chapter link.
      if (href && href.indexOf("/manhwa/") === 0 && href.split("/").length > 3)
        href = href.substring(0, href.lastIndexOf("/"));
      var name = this.text(card.selectFirst(".upd-title"));
      var img = card.selectFirst(".upd-thumb img");
      var link = this.absolute(href);
      if (!name || !href || seen[link]) continue;
      seen[link]=true;
      list.push({name: name, link: link, imageUrl: this.absolute(this.attr(img,"src"))});
    }
    return {list: list, hasNextPage: false}; // Pagination not verified in snapshot.
  }
  async getPopular(page) {
    if (page > 1) return {list:[],hasNextPage:false};
    return await this.listing("/manhwa/updates", "li.upd-card");
  }
  async getLatestUpdates(page) { return await this.getPopular(page); }
  async search(query, page, filters) {
    if (page > 1) return {list:[],hasNextPage:false};
    // Search HTML was not part of the supplied snapshots; do not claim supported.
    // Best-effort use of verified search form parameters.
    var d = await this.doc("/search?q=" + encodeURIComponent(query || "") + "&field=title&match=contains");
    var links = d.select('a[href^="/manhwa/"]');
    var list = [], seen = {};
    for (var i=0; i<links.length; i++) {
      var a=links[i], href=this.attr(a,"href");
      if (!/^\/manhwa\/[^/]+$/.test(href)) continue;
      var name=this.text(a);
      if (!name || name === "만화" || name === "전편보기" || seen[href]) continue;
      seen[href]=true;
      list.push({name:name,link:this.absolute(href)});
    }
    return {list:list,hasNextPage:false};
  }
  async getDetail(url) {
    var path=this.path(url);
    // Follow series page rather than episode page.
    var bits=path.split("/").filter(Boolean);
    if (bits.length > 2 && bits[0] === "manhwa") path="/"+bits.slice(0,2).join("/");
    var d=await this.doc(path);
    var title=this.text(d.selectFirst("h1.hero-v2-title"));
    var cover=d.selectFirst('meta[property="og:image"]');
    var intro=d.selectFirst(".hero-v2-description") || d.selectFirst(".hero-v2-synopsis");
    var author=d.selectFirst(".hero-v2-author");
    var genreEls=d.select(".hero-v2-tags a, .hero-v2-genres a, .hero-v2-genre a");
    var genres=[];
    for (var i=0;i<genreEls.length;i++) { var g=this.text(genreEls[i]); if(g) genres.push(g.replace(/^#/,"")); }
    var rows=d.select("li.ep-row-v2 a.ep-row-v2-link");
    var chapters=[],seen={};
    for(var j=0;j<rows.length;j++) {
      var row=rows[j],href=this.attr(row,"href");
      if(!href || seen[href]) continue;
      seen[href]=true;
      var name=this.text(row.selectFirst(".ep-row-v2-title strong")) || this.text(row.selectFirst(".ep-row-v2-title"));
      chapters.push({name:name||("회차 "+(j+1)),url:this.absolute(href)});
    }
    if(!title) throw new Error("상세 페이지 제목 선택자를 찾지 못함 (구조 변경 또는 차단)");
    return {name:title,link:this.absolute(path),imageUrl:this.absolute(this.attr(cover,"content")),
      author:this.text(author),description:this.text(intro),genre:genres,
      status: d.selectFirst(".pill-status.ongoing") ? 0 : 5, chapters:chapters};
  }
  async getPageList(url) {
    var d=await this.doc(url);
    var images=d.select(".vw-imgs img.viewer-ratio-img");
    var container=d.selectFirst(".vw-imgs");
    var expected=Number(this.attr(container,"data-viewer-image-count")||0);
    var pages=[], seen={};
    for(var i=0;i<images.length;i++) {
      var src=this.attr(images[i],"src") || this.attr(images[i],"data-src");
      if (!src || seen[src]) continue;
      seen[src]=true;
      pages.push({url:this.absolute(src),headers:{"Referer":this.base+"/"}});
    }
    // Most important: do NOT show a chapter as complete when only first two
    // virtualized images were delivered in HTML.
    if(expected>pages.length) {
      throw new Error("이 사이트는 이미지를 가상 렌더링함: HTML "+pages.length+"장 / 전체 "+expected+"장. 전체 회차 이미지 API 미확인.");
    }
    if(!pages.length) throw new Error("이미지 URL을 찾지 못함. 뷰어 또는 접근 제한 확인 필요.");
    return pages;
  }
  getFilterList() { return []; }
  getSourcePreferences() { return []; }
}
