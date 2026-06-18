function qs(sel){ return document.querySelector(sel); }

const form = qs('#fetchForm');
const result = qs('#result');
const select_catalog_list = qs('#catalog-list');
const delete_catalog_item = qs('#delete-catalog-item');



const STORAGE_KEY_SUBMIT_FORM = 'opds_reader_js_submit_form';
const STORAGE_KEY_CATALOG_LIST = 'opds_reader_js_catalog_list';

const urlStack = [];
var catalogList = []; // List mit all loaded catalog urls with username/password

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  urlStack.length = 0; // clear url stack

  fetchOpds('');

  const store = {
    url: qs('#url').value,
    username: qs('#username').value,
    password: qs('#password').value
  }
  localStorage.setItem(STORAGE_KEY_SUBMIT_FORM, JSON.stringify(store));

  const item = catalogList.find(c => c.url === store.url);
  if (!item) {
    catalogList.push(store);
    localStorage.setItem(STORAGE_KEY_CATALOG_LIST, JSON.stringify(catalogList.sort((a, b) => a.url.localeCompare(b.url))));
    updateCatalogList();
  }
});

form.addEventListener('reset', async (e) => {
  e.preventDefault();
  localStorage.removeItem(STORAGE_KEY_SUBMIT_FORM);
  qs('#url').value = '';
  qs('#username').value = '';
  qs('#password').value = '';
});

select_catalog_list.addEventListener('click', async (e) => {
    const s = JSON.parse(select_catalog_list.value);
  
    qs('#url').value = s.url;
    qs('#username').value = s.username;
    qs('#password').value = s.password;
    
});

delete_catalog_item.addEventListener('click', async (e) => {
    
    const s = JSON.parse(select_catalog_list.value);
    if (window.confirm('Would you like to delete ' + s.url + '?')) {
        catalogList = catalogList.filter(c => c.url !== s.url);
        localStorage.setItem(STORAGE_KEY_CATALOG_LIST, JSON.stringify(catalogList));
        updateCatalogList();
        qs('#url').value = '';
        qs('#username').value = '';
        qs('#password').value = '';
    }
});    

function escapeHtml(s){
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function renderXmlObject(obj){
    if (!obj) return '<p>No data.</p>';

    // OPDS is Atom-based; try common keys
    const feed = obj.feed || obj.catalog || obj;
    let html = '';

    const opdsUrl = qs('#url').value.trim();
    const base = new URL(opdsUrl).origin;

    if (feed.title) html += `<h2>${escapeHtml(feed.title)}</h2>`;
    if (feed.updated) html += `<p>Updated: ${escapeHtml(feed.updated)}</p>`;

    if (urlStack.length > 0) {
        html += `<p><a back-link href="` + urlStack[urlStack.length - 1] + `" id="backLink">🔙 Back</a></p>`;
    }

    const feedLinks = feed.link || feed.links || [];
    
    const flist = Array.isArray(feedLinks) ? feedLinks : (feedLinks ? [feedLinks] : []);

    let hasSearchSubsectionLink = false;
    let opensearchdescriptionHref = ''

    if (flist.length) {
        html += '<div class="links">';
        for (const l of flist) {
            const href = l.href || l['@_href'] || l;
            const rel = l.rel || '';
            const type = l.type || '';
            if (href) {
                const baseHref = href.startsWith('http') ? '' : base; // Only prepend base if href is relative
                if (rel === "alternate") {
                    const title = l.title || rel || href;
                    html += `<a href="${baseHref + escapeHtml(href)}" target="_blank" rel="noreferrer">🌐 (alternate): ${escapeHtml(title)}</a> `;
                } else if (rel == "search" && type.includes("application/opensearchdescription+xml")) {
                    if (href.endsWith('.xml')) {
                        opensearchdescriptionHref = href;
                    } else {
                        const title = l.title || rel || href;
                        html += `<a 'data-opds' href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${href.includes("searchTerms") ? '🔍 ' : '' }${escapeHtml(title)}</a> `;
                        hasSearchSubsectionLink = href.includes("searchTerms");    
                    }
                } else if (type.includes("application/atom+xml")) {
                    const title = l.title || rel || href;
                    html += `<a data-opds href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${href.includes("searchTerms") ? '🔍 ' : '' }${escapeHtml(title)}</a> `;
                    hasSearchSubsectionLink = href.includes("searchTerms");
                } else {
                    const title = l.title || rel || href;
                    html += `<a href="${baseHref + escapeHtml(href)}" target="_blank" rel="noreferrer">🌐:${escapeHtml(title)} (${rel}, ${type})</a> `;
                }
            }
        }
        console.log(hasSearchSubsectionLink, opensearchdescriptionHref);
        

        if (!hasSearchSubsectionLink && opensearchdescriptionHref.length > 0) {
            // fetch opensearchxml and catch search href
            let osOrigin = undefined
            try {
                osOrigin = new URL(opensearchdescriptionHref)?.origin
            } catch (e) {

            }

            const resp = await fetch('/fetch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: osOrigin ? opensearchdescriptionHref : base +  opensearchdescriptionHref})
            });
            const data = await resp.json();

            if (data.error) {
                console.log("opensearch", data.error)
            } else {
                const sList = data.xml.OpenSearchDescription.Url
                const searchUrls = Array.isArray(sList) ? sList : (sList ? [sList] : []);  ;
                const ss = searchUrls.find(u => u.type === "application/atom+xml")
                if (ss) {
                    const href = ss.template                
                    html += `<a data-opds href="${href}" target="_blank" rel="noreferrer">${href.includes("searchTerms") ? '🔍 ' : '' }search</a> `;
                }
            }
        }
    
      html += '</div>';
    }


  const entries = feed.entry || feed['atom:entry'] || feed.entrys || [];
  const list = Array.isArray(entries) ? entries : (entries ? [entries] : []);

  if (list.length === 0) html += '<p>No entries found..</p>';

  html += '<ul class="entries">';
  for (const e of list) {
    const title = e.title || e['dc:title'] || '—';
    const updated = e.updated || e.published || '';
    const author = (e.author && (e.author.name || e.author)) || (e['dc:creator'] && e['dc:creator']) || '';
    let summary = e.summary || e.content || '';

    if (summary && typeof summary === 'object') {
        if (summary._) { 
            summary = summary._; // Handle cases where summary/content is an object with _ as text
        } else if (summary.type === 'xhtml') {
            summary = summary.div;
        }
    }

    let ca = e.category || e.categories || [];
    // links
    const links = e.link || e.links || [];
    const llist = Array.isArray(links) ? links : (links ? [links] : []);

    html += '<li class="entry">';
    const thumbnailLink = llist.find(l => l.rel === 'http://opds-spec.org/image/thumbnail') 
    let thumbnailHref = thumbnailLink?.href
    let thHasOrigin = false
    try {
        if (thumbnailHref) {
            if (new URL(thumbnailHref).origin) 
                thHasOrigin = true
        }
    } catch (e) {
        
    }

    const thumbnail = thumbnailHref ? `<img src="${thHasOrigin ? thumbnailHref: base + thumbnailHref}" width="50" alt="thumbnail" class="image" />` : '';

    html += `<h3 class="title">${thumbnail}${escapeHtml(title)}</h3>`;
    if (author) html += `<p class="meta">Autor: ${escapeHtml(author)}</p>`;
    if (updated) html += `<p class="meta">Datum: ${escapeHtml(updated)}</p>`;
    
    if (summary) {
        html += '<div class="summary">';
        html += `${typeof summary === 'object' ? JSON.stringify(summary) : summary}`; 
        html += '</div>';
    }
    if (ca) {
    if (!Array.isArray(ca)) ca = [ca];
      html += '<div class="categories">';
      for (const c of ca) {
        const term = c.term || c.label || '—';
        html += `<span class="category">${escapeHtml(term)}</span>`;
      }
      html += '</div>';
    }


    
    if (llist.length) {
        html += '<div class="links"><div class="links-content">';
        
      for (const l of llist) {
            const title = l.title || l['@_title'] || '';
            const href = l.href || l['@_href'] || l;
            const rel = l.rel || '';
            const type = l.type || '';
            if (href) {
                
                const baseHref = href.startsWith('http') ? '' : base; // Only prepend base if href is relative
                if (rel === 'http://opds-spec.org/image/thumbnail')
                    continue

                if (rel.includes("http://opds-spec.org/acquisition")) {
                    html += `<a href="${baseHref + escapeHtml(href)}" target="_blank" rel="noreferrer">[⬇️ Download ${escapeHtml(title)} ${escapeHtml(type)}]</a> `;
                } else if (rel === "http://opds-spec.org/image") {
                    html += `<a href="${baseHref + escapeHtml(href)}" target="_blank" rel="noreferrer">
                    <img src="${baseHref + escapeHtml(href)}" width="50" alt="Cover" class="image" />
                    </a> `;
                } else if (rel === "alternate") {
                    const title = l.title || rel || href;
                    html += `<a href="${baseHref + escapeHtml(href)}" target="_blank" rel="noreferrer">🌐 (alternate): ${escapeHtml(title)}</a> `;
                } else if (type.includes("application/atom+xml")) {
                    const title = l.title || rel || href;
                    html += `<a data-opds href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(title)}</a> `;
                } else {
                    const title = l.title || rel || href;
                    html += `<a href="${baseHref + escapeHtml(href)}" target="_blank" rel="noreferrer">🌐:${escapeHtml(title)}</a> `;
                }
            }
      }
      html += '</div></div>';
    }

    html += '</li>';
  }
  html += '</ul>';

  return html;
}

async function fetchOpds(href){
    result.innerHTML = '<p>Load...</p>';

    const url = qs('#url').value.trim();
    const originUrl = href !== '' ? new URL(url).origin : url;


    let hrefOrigin = undefined
    
    try{
        hrefOrigin = new URL(href).origin  
    } catch (e) {

    }

    console.log('hrefOrigin', hrefOrigin);
    
    const username = qs('#username').value.trim();
    const password = qs('#password').value;
    const searchField = qs('#search').value.trim().toLowerCase();

    const fetchHref = href.replace('{searchTerms}', encodeURIComponent(searchField)).replace('{startPage', 0);

    try {
        const resp = await fetch('/fetch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: hrefOrigin ? fetchHref : originUrl + fetchHref, username, password })
        });
        const data = await resp.json();

        if (data.error) {
            result.innerHTML = `<pre class="error">Fehler: ${escapeHtml(data.error)}</pre>`;
            return;
        }

        if (data.raw) {
            const html = `<h2>Raw XML</h2>`;
            if (urlStack.length > 0) {
                html += `<p><a back-link href="` + urlStack[urlStack.length - 1] + `" id="backLink">🔙 Back</a></p>`;
            }
            html = html + `<pre>${escapeHtml(data.raw)}</pre>`;
            result.innerHTML = html;
            attachLinkHandler();
            urlStack.push(fetchHref);
            return;
        }

        result.innerHTML = await renderXmlObject(data.xml);
        attachLinkHandler();
        urlStack.push(fetchHref);
    } catch (err) {
        result.innerHTML = `<pre class="error">${escapeHtml(err.message)}</pre>
        <button type="button" class="retry" onclick="fetchOpds('${href}')">Retry</button>
        `;
    }
}


// Attach click handler to links rendered from OPDS feed so they are loaded via proxy
function attachLinkHandler(){
    // Attach back link handler
    result.querySelectorAll('a[back-link]').forEach(a => {
        a.addEventListener('click', async (ev) => {
            ev.preventDefault();
            urlStack.pop(); // Remove current URL
            const parentUrl = urlStack.pop() || ''; // Get parent URL
            
            console.log('back ' + parentUrl);
            await fetchOpds(parentUrl);
        });
    });
    
    // delegate
    result.querySelectorAll('a[data-opds]').forEach(a => {
        a.addEventListener('click', async (ev) => {
            ev.preventDefault();
            const href = a.getAttribute('href');
            if (!href) return;
            await fetchOpds(href);
        });
    });
}


function updateCatalogList() {
    qs('#catalog-list').innerHTML = '';

    console.log('catalogList', catalogList)

    catalogList.forEach(c => {
        const option = document.createElement('option');
        option.value = JSON.stringify(c);
        option.text = c.url;
        qs('#catalog-list').appendChild(option);
    });
}


document.addEventListener('DOMContentLoaded', () => {
    const store = localStorage.getItem(STORAGE_KEY_SUBMIT_FORM);
    if (store) {
        const storeObj = JSON.parse(store);
        qs('#url').value = storeObj.url;
        qs('#username').value = storeObj.username;
        qs('#password').value = storeObj.password;
    } else {
        const url = window.location.origin + "/opds"
        qs('#url').value = url;
    }
    const catalogListStore = localStorage.getItem(STORAGE_KEY_CATALOG_LIST);
    console.log('catalogListStore', catalogListStore);
       
    if (catalogListStore) {
        catalogList = JSON.parse(catalogListStore);
        updateCatalogList();
    }

});