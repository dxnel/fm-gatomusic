export default async function handler(req, res) {
  // Get the slug from the URL (e.g. /my-release-slug)
  const urlPath = req.url.split('?')[0];
  const slug = urlPath.split('/')[1] || ''; 

  // Grab the Supabase keys from your Vercel Environment Variables
  const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

  // Default Fallback Meta Tags (for /admin or missing links)
  let title = "fm GATO";
  let desc = "Access the latest music releases on fm GATO.";
  let img = "https://fm.gatomusic.ch/src/assets/gato_logo.png"; // Fallback image

  // If it's a release link, fetch the exact cover art and text from Supabase
  if (slug && slug !== 'admin' && slug !== 'callback') {
    try {
      const supaRes = await fetch(`${SUPABASE_URL}/rest/v1/releases?id=eq.${slug}&select=*`, {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`
        }
      });
      const data = await supaRes.json();
      
      if (data && data.length > 0) {
        const release = data[0];
        title = `${release.artist} - ${release.title} | fm GATO`;
        desc = `Listen to '${release.title}' by ${release.artist}.`;
        if (release.cover_url) img = release.cover_url;
      }
    } catch (e) {
      console.error("Supabase fetch failed", e);
    }
  }

  // Fetch your blank Vue index.html
  try {
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const htmlRes = await fetch(`${proto}://${host}/index.html`);
    let html = await htmlRes.text();

    // Inject the Social Embed tags right before </head>
    const metaTags = `
      <title>${title}</title>
      <meta property="og:type" content="music.song" />
      <meta property="og:title" content="${title}" />
      <meta property="og:description" content="${desc}" />
      <meta property="og:image" content="${img}" />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content="${title}" />
      <meta name="twitter:description" content="${desc}" />
      <meta name="twitter:image" content="${img}" />
    `;

    html = html.replace('</head>', `${metaTags}\n</head>`);

    // Cache the resulting page on Vercel's CDN for 60 seconds so it loads instantly
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.status(200).send(html);
    
  } catch (err) {
    res.status(500).send('Error generating link preview');
  }
}