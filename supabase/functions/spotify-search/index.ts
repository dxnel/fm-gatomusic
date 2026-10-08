import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req: Request) => {
  // Gestion du CORS pour Vue.js
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { isrc } = await req.json()
    if (!isrc) throw new Error("Code ISRC manquant")

    // 1. Récupération de tes clés cachées
    const clientId = Deno.env.get('SPOTIFY_CLIENT_ID')
    const clientSecret = Deno.env.get('SPOTIFY_CLIENT_SECRET')

    // 2. Demande d'un jeton d'accès temporaire serveur-à-serveur
    const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + btoa(`${clientId}:${clientSecret}`)
      },
      body: new URLSearchParams({ grant_type: 'client_credentials' })
    })
    
    const tokenData = await tokenRes.json()
    if (tokenData.error) throw new Error("Erreur authentification Spotify")
    
    const accessToken = tokenData.access_token

    // 3. Recherche de la track via l'ISRC
    const searchRes = await fetch(`https://api.spotify.com/v1/search?type=track&q=isrc:${isrc}`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    })
    
    const searchData = await searchRes.json()
    
    let spotifyUrl = null
    // Si Spotify trouve une correspondance, on isole l'URL de la musique
    if (searchData.tracks && searchData.tracks.items && searchData.tracks.items.length > 0) {
      spotifyUrl = searchData.tracks.items[0].external_urls.spotify
    }

    // 4. On renvoie le lien à ton site Admin
    return new Response(JSON.stringify({ spotify_url: spotifyUrl }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    })

  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400
    })
  }
})