import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const archive = path.join(root, '.migration-archive');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'migration/url-manifest.json'), 'utf8'));
const assets = JSON.parse(fs.readFileSync(path.join(root, 'migration/assets-manifest.json'), 'utf8')).assets;
const dataDir = path.join(root, 'src/data');
const publicDir = path.join(root, 'public');
const repairedLinks = {
  '/home/actian': '/home/actian-intro',
  '/home/actian-local': '/home/actian-vector-local-installation-data-loading-and-querying',
  '/home/ibm-watson-visual-recognition-code-example': '/home/ibm-watson-visual-recognition',
};
const directoryCategoryNames = [
  'h4cker Blog Posts',
  'Virtual Machines, Virtual Environments, and Docker',
  'DevOps - Git and Continuous Integration/Deployment',
  'C++ Coding',
  'Algorithms',
  'Algorithms (Interview Questions)',
  'Python Coding',
  'Java Coding',
  'Blockchain',
  'How To Make An API',
  'Web Development',
  'Databases',
  'Actian Vector',
  'Machine Learning',
  'IBM Watson/Bluemix',
  'Events Attended',
  'Gaming Blog Posts',
  'IBM Ponder This',
];

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(publicDir, { recursive: true });

function localPath(value) {
  if (!value) return value;
  try {
    const url = new URL(value, 'https://www.srcmake.com');
    if (/^(?:www\.)?(?:srcmake|weebly)\.com$/i.test(url.hostname) && url.pathname.startsWith('/uploads/')) {
      return `${url.pathname}${url.search}${url.hash}`;
    }
  } catch {
    // Leave malformed third-party URLs untouched rather than altering article prose.
  }
  const normalized = value.replace(/^https?:\/\/(?:www\.)?srcmake\.com/i, '').replace(/^\/\/(?:www\.)?srcmake\.com/i, '');
  if (normalized.startsWith('/')) return repairedLinks[normalized] ?? normalized;
  return value;
}

function cleanFragment(fragment) {
  const $ = cheerio.load(`<main>${fragment}</main>`, { decodeEntities: false });
  const article = $('main');
  article.find('script').each((_, element) => {
    const src = $(element).attr('src') || '';
    if (/^https:\/\/gist\.github\.com\/.+\.js(?:\?|$)/.test(src)) {
      $(element).after('<p class="embed-fallback">Code example: this article embeds a GitHub Gist. If it does not load, open the Gist link from your browser.</p>');
    } else {
      $(element).remove();
    }
  });
  article.find('link, style').remove();
  article.find('a.__cf_email__[data-cfemail]').each((_, element) => {
    const encoded = $(element).attr('data-cfemail');
    const key = Number.parseInt(encoded.slice(0, 2), 16);
    const email = Array.from({ length: (encoded.length - 2) / 2 }, (_, index) =>
      String.fromCharCode(Number.parseInt(encoded.slice(index * 2 + 2, index * 2 + 4), 16) ^ key),
    ).join('');
    $(element).attr('href', `mailto:${email}`).removeAttr('data-cfemail').removeClass('__cf_email__').text(email);
  });
  article.find('*').each((_, element) => {
    for (const attribute of ['href', 'src', 'poster']) {
      const value = $(element).attr(attribute);
      if (value) $(element).attr(attribute, localPath(value));
    }
    if (element.name === 'iframe') {
      const src = $(element).attr('src') || '';
      if (src.startsWith('//www.youtube.com/')) $(element).attr('src', `https:${src}`);
      $(element).attr('loading', 'lazy');
      $(element).attr('title', 'Embedded YouTube video');
    }
  });
  return article.html().trim();
}

function description($, content) {
  const fromMeta = $('meta[name="description"]').attr('content') || '';
  const text = (fromMeta || cheerio.load(content).text()).replace(/\s+/g, ' ').trim();
  return text.slice(0, 160);
}

function articleExcerpt(content) {
  const $ = cheerio.load(content, { decodeEntities: false });
  const firstParagraph = $('p, .paragraph').filter((_, element) => $(element).text().replace(/\s+/g, ' ').trim().length > 30).first().text();
  const text = (firstParagraph || $.text()).replace(/\s+/g, ' ').trim();
  if (text.length <= 190) return text;
  return `${text.slice(0, 187).replace(/\s+\S*$/, '')}…`;
}

function thumbnailFor(content) {
  const $ = cheerio.load(content, { decodeEntities: false });
  const image = $('img').map((_, element) => $(element).attr('src')).get().find((src) =>
    src?.startsWith('/uploads/') && !/(?:logo(?:_|\.|$)|donate|tip-button|background|icon|social|discord)/i.test(src),
  );
  if (image) return { type: 'article-image', src: image };
  return { type: 'fallback' };
}

const postPages = manifest.pages.filter((page) => page.page_type === 'blog_post');
if (postPages.length !== 86) throw new Error(`Expected 86 posts, found ${postPages.length}.`);

const posts = postPages.map((page) => {
  const slug = page.pathname.split('/').pop();
  const source = fs.readFileSync(path.join(archive, 'html/posts', `${slug}.html`), 'utf8');
  const $ = cheerio.load(source, { decodeEntities: false });
  const content = cleanFragment($('.blog-content').first().html() || '');
  if (!content) throw new Error(`No article content extracted for ${slug}.`);
  return {
    slug,
    title: page.title,
    date: page.publication_date,
    description: description($, content),
    excerpt: articleExcerpt(content),
    thumbnail: thumbnailFor(content),
    content,
  };
});

posts.sort((a, b) => new Date(b.date) - new Date(a.date));
fs.writeFileSync(path.join(dataDir, 'posts.json'), `${JSON.stringify(posts, null, 2)}\n`);

const postsBySlug = new Map(posts.map((post) => [post.slug, post]));
const archivePages = Array.from({ length: 29 }, (_, index) => {
  const page = index + 1;
  const archiveFile = path.join(archive, 'html/archive', `${page}.html`);
  let slugs = [];
  if (fs.existsSync(archiveFile)) {
    const $ = cheerio.load(fs.readFileSync(archiveFile, 'utf8'));
    slugs = $('.blog-title-link').map((_, element) => {
      const href = $(element).attr('href') || '';
      return href.split('/').pop();
    }).get();
  }
  // The archive does not contain an HTML capture for page 1 or 17. Date order
  // reconstructs those two pages; every captured page retains its source order.
  if (!slugs.length) slugs = posts.slice(index * 3, (index + 1) * 3).map((post) => post.slug);
  return { page, posts: slugs.map((slug) => postsBySlug.get(slug)).filter(Boolean) };
});
fs.writeFileSync(path.join(dataDir, 'archives.json'), `${JSON.stringify(archivePages, null, 2)}\n`);

const directory$ = cheerio.load(fs.readFileSync(path.join(archive, 'html/pages/directory.html'), 'utf8'));
const sourceGroups = directory$('#wsite-content .paragraph').filter((_, element) => directory$(element).find('a[href*="/home/"]').length).toArray();
if (sourceGroups.length !== directoryCategoryNames.length) throw new Error(`Expected ${directoryCategoryNames.length} directory categories, found ${sourceGroups.length}.`);
const assigned = new Set();
const categories = sourceGroups.map((element, index) => {
  const slugs = directory$(element).find('a[href*="/home/"]').map((_, link) => {
    const href = directory$(link).attr('href') || '';
    return href.match(/\/home\/([^?#/]+)/)?.[1];
  }).get().filter(Boolean).filter((slug) => {
    // The legacy DevOps section contains a blank duplicate link to VPN.
    if (assigned.has(slug)) return false;
    assigned.add(slug);
    return true;
  });
  return { name: directoryCategoryNames[index], posts: slugs.map((slug) => postsBySlug.get(slug)).filter(Boolean) };
});
for (const [slug, categoryName] of Object.entries({
  'cpp-cuda-gpu': 'C++ Coding',
  'ethereum-donate-button': 'Blockchain',
  'segment-tree': 'Algorithms',
})) {
  if (assigned.has(slug)) throw new Error(`Directory source unexpectedly already contains ${slug}.`);
  const category = categories.find(({ name }) => name === categoryName);
  category.posts.push(postsBySlug.get(slug));
  assigned.add(slug);
}
if (assigned.size !== posts.length || categories.some((category) => category.posts.some((post) => !post))) {
  throw new Error(`Directory categorization incomplete: ${assigned.size} of ${posts.length} posts assigned.`);
}
fs.writeFileSync(path.join(dataDir, 'categories.json'), `${JSON.stringify(categories, null, 2)}\n`);

const aboutSource = fs.readFileSync(path.join(archive, 'html/pages/about.html'), 'utf8');
const about$ = cheerio.load(aboutSource, { decodeEntities: false });
fs.writeFileSync(path.join(dataDir, 'about.html'), `${cleanFragment(about$('#wsite-content').first().html() || '')}\n`);

let copiedAssets = 0;
for (const asset of assets) {
  const sourceUrl = new URL(asset.source_url);
  if (!asset.archived || !sourceUrl.pathname.startsWith('/uploads/')) continue;
  const destination = path.join(publicDir, sourceUrl.pathname);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(path.join(root, asset.archive_path), destination);
  copiedAssets += 1;
}

function redirectDocument(target, title = 'Page moved') {
  const canonical = `https://www.srcmake.com${target}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><link rel="canonical" href="${canonical}"><meta http-equiv="refresh" content="0; url=${target}"></head><body><main><p>This page has moved to <a href="${target}">${target}</a>.</p></main></body></html>\n`;
}

function writePublic(relativePath, content) {
  const file = path.join(publicDir, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

for (const page of manifest.pages.filter((page) => page.page_type === 'legacy_blog_post_alias')) {
  const target = page.intended_migration_status.replace('redirect_to:', '');
  writePublic(page.pathname.slice(1), redirectDocument(target, page.title));
}
for (const [oldPath, target] of Object.entries(repairedLinks)) {
  writePublic(`${oldPath.slice(1)}/index.html`, redirectDocument(target, 'Article moved'));
}

const gistInstances = posts.reduce((total, post) => total + (post.content.match(/<script[^>]+gist\.github\.com\//g) || []).length, 0);
const youtubeInstances = posts.reduce((total, post) => total + (post.content.match(/youtube\.com\/embed\//g) || []).length, 0);
const thumbnailCounts = posts.reduce((counts, post) => {
  counts[post.thumbnail.type] += 1;
  return counts;
}, { 'article-image': 0, 'youtube-thumbnail': 0, fallback: 0 });
const youtubeThumbnailIds = [...new Set(posts.filter((post) => post.thumbnail.type === 'youtube-thumbnail').map((post) => post.thumbnail.videoId))];
fs.writeFileSync(path.join(dataDir, 'migration-stats.json'), `${JSON.stringify({
  postCount: posts.length,
  copiedAssets,
  gistInstances,
  youtubeInstances,
  thumbnailCounts,
  youtubeThumbnailIds,
  directoryCategoryCount: categories.length,
  repairedLinks,
}, null, 2)}\n`);

console.log(`Generated ${posts.length} posts, copied ${copiedAssets} upload assets, preserved ${youtubeInstances} YouTube and ${gistInstances} Gist embeds.`);
