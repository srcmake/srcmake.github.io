import fs from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';

const root = process.cwd();
const dist = path.join(root, 'dist');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'migration/url-manifest.json'), 'utf8'));
const posts = JSON.parse(fs.readFileSync(path.join(root, 'src/data/posts.json'), 'utf8'));
const archivePages = JSON.parse(fs.readFileSync(path.join(root, 'src/data/archives.json'), 'utf8'));
const categories = JSON.parse(fs.readFileSync(path.join(root, 'src/data/categories.json'), 'utf8'));
const failures = [];
const archivedCategoryNames = [
  'h4cker Blog Posts', 'Virtual Machines, Virtual Environments, and Docker',
  'DevOps - Git and Continuous Integration/Deployment', 'C++ Coding', 'Algorithms',
  'Algorithms (Interview Questions)', 'Python Coding', 'Java Coding', 'Blockchain',
  'How To Make An API', 'Web Development', 'Databases', 'Actian Vector',
  'Machine Learning', 'IBM Watson/Bluemix', 'Events Attended', 'Gaming Blog Posts', 'IBM Ponder This',
];
const expectedFile = (pathname) => {
  if (pathname === '/') return path.join(dist, 'index.html');
  if (pathname.endsWith('.html')) return path.join(dist, pathname.slice(1));
  return path.join(dist, pathname.slice(1), 'index.html');
};
const expectFile = (pathname, label = pathname) => {
  if (!fs.existsSync(expectedFile(pathname))) failures.push(`Missing ${label}: ${expectedFile(pathname)}`);
};

if (posts.length !== 86) failures.push(`Expected 86 primary posts; found ${posts.length}.`);
const directorySlugs = categories.flatMap((category) => category.posts.map((post) => post.slug));
if (categories.length !== 18) failures.push(`Expected 18 Directory categories; found ${categories.length}.`);
if (categories.map((category) => category.name).join('|') !== archivedCategoryNames.join('|')) failures.push('Directory category names differ from the archived Directory.');
if (directorySlugs.length !== 86 || new Set(directorySlugs).size !== 86) failures.push('Directory does not contain exactly one entry for each of 86 posts.');
if (new Set(directorySlugs).size === 86 && [...new Set(directorySlugs)].some((slug) => !posts.some((post) => post.slug === slug))) failures.push('Directory references a post not in the primary post inventory.');
const archivedDirectory = cheerio.load(fs.readFileSync(path.join(root, '.migration-archive/html/pages/directory.html'), 'utf8'));
const archivedAssignments = new Map();
archivedDirectory('#wsite-content .paragraph').each((_, element) => {
  archivedDirectory(element).find('a[href*="/home/"]').each((_, link) => {
    const slug = (archivedDirectory(link).attr('href') || '').match(/\/home\/([^?#/]+)/)?.[1];
    if (slug && !archivedAssignments.has(slug)) archivedAssignments.set(slug, archivedCategoryNames.find((name, index) => index === [...archivedDirectory('#wsite-content .paragraph').filter((_, item) => archivedDirectory(item).find('a[href*="/home/"]').length).toArray()].indexOf(element)));
  });
});
for (const [slug, categoryName] of archivedAssignments) {
  if (!categories.find((category) => category.name === categoryName)?.posts.some((post) => post.slug === slug)) failures.push(`Directory assignment changed for ${slug}.`);
}
for (const page of manifest.pages.filter((page) => page.page_type === 'blog_post')) expectFile(page.pathname, 'primary post');
for (const page of manifest.pages.filter((page) => page.page_type === 'legacy_blog_post_alias')) expectFile(page.pathname, 'legacy alias');
for (const page of manifest.pages.filter((page) => page.page_type === 'blog_index_archive')) expectFile(page.pathname, 'archive');
for (const pathname of ['/', '/about', '/about.html', '/directory', '/directory.html']) expectFile(pathname);

const htmlFiles = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.html')) htmlFiles.push(full);
  }
}
walk(dist);
for (const post of posts) {
  const html = fs.readFileSync(expectedFile(`/home/${post.slug}`), 'utf8');
  const $ = cheerio.load(html);
  if ($('h1').first().text().trim() !== post.title) failures.push(`Title missing from ${post.slug}.`);
  if (!$('time').first().text().includes(post.date)) failures.push(`Date missing from ${post.slug}.`);
}
for (const archive of archivePages) {
  const source = path.join(root, `.migration-archive/html/archive/${archive.page}.html`);
  if (!fs.existsSync(source)) continue;
  const $ = cheerio.load(fs.readFileSync(source, 'utf8'));
  const original = $('.blog-title-link').map((_, element) => ($(element).attr('href') || '').split('/').pop()).get();
  if (original.join('|') !== archive.posts.map((post) => post.slug).join('|')) {
    failures.push(`Archive ordering differs from source on page ${archive.page}.`);
  }
}

for (const file of htmlFiles) {
  const html = fs.readFileSync(file, 'utf8');
  if (/weebly\.com|editmysite\.com|Powered by Weebly/i.test(html)) failures.push(`Weebly dependency remains in ${path.relative(dist, file)}.`);
  const $ = cheerio.load(html);
  if ($('nav').text().match(/contact/i)) failures.push(`Contact remains in navigation: ${path.relative(dist, file)}.`);
  $('img[src], source[src], video[poster]').each((_, element) => {
    const value = $(element).attr('src') || $(element).attr('poster');
    if (value?.startsWith('/uploads/') || value?.startsWith('/thumbnails/')) {
      const local = path.join(dist, value.split(/[?#]/)[0]);
      if (!fs.existsSync(local)) failures.push(`Missing local asset ${value} referenced by ${path.relative(dist, file)}.`);
    }
  });
  $('a[href]').each((_, element) => {
    const href = $(element).attr('href');
    if (!href || !href.startsWith('/') || href.startsWith('//') || href.startsWith('/uploads/')) return;
    const pathname = href.split(/[?#]/)[0];
    if (!fs.existsSync(expectedFile(pathname))) failures.push(`Broken internal link ${href} in ${path.relative(dist, file)}.`);
  });
}

const directoryHtml = cheerio.load(fs.readFileSync(expectedFile('/directory'), 'utf8'));
const renderedDirectorySlugs = directoryHtml('.directory-entry a').map((_, element) => (directoryHtml(element).attr('href') || '').split('/').pop()).get();
if (renderedDirectorySlugs.length !== 86 || new Set(renderedDirectorySlugs).size !== 86) failures.push('Built Directory does not render all 86 articles exactly once.');
if (directoryHtml('.directory-category').length !== 18) failures.push('Built Directory category count does not match the archived Directory.');

for (const pathname of ['/directory', '/directory.html', '/about', '/about.html']) {
  const html = fs.readFileSync(expectedFile(pathname), 'utf8');
  const $ = cheerio.load(html);
  if ($('meta[http-equiv="refresh"]').length || /(?:window\.)?location(?:\.href)?\s*=|location\.replace\s*\(/i.test(html)) {
    failures.push(`Compatibility page redirects instead of rendering content: ${pathname}.`);
  }
  if (pathname.startsWith('/directory') && $('.directory-entry').length !== 86) failures.push(`Directory content missing from ${pathname}.`);
  if (pathname.startsWith('/about') && $('.page-content').length !== 1) failures.push(`About content missing from ${pathname}.`);
}

if (failures.length) {
  console.error(`Migration validation failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`Migration validation passed: ${posts.length} posts, ${htmlFiles.length} built HTML files, all manifest routes and local assets verified.`);
