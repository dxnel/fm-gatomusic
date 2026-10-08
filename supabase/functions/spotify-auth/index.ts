import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Configuration pour autoriser ton site Vue.js à parler à cette fonction
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req: Request) => {
  // Gestion du CORS (Obligatoire pour les appels API depuis un navigateur)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 1. On récupère les données envoyées par ton site Vue.js
    const { code, releaseId } = await req.json()

    if (!code || !releaseId) {
      throw new Error("Code Spotify ou Release ID manquant")
    }

    // 2. On récupère tes clés secrètes cachées dans Supabase
    const clientId = Deno.env.get('SPOTIFY_CLIENT_ID')
    const clientSecret = Deno.env.get('SPOTIFY_CLIENT_SECRET')
    const redirectUri = Deno.env.get('SPOTIFY_REDIRECT_URI')

    // 3. On appelle Spotify pour échanger le Code contre les Tokens
    const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + btoa(clientId + ':' + clientSecret)
      },
      body: new URLSearchParams({
        code: code,
        redirect_uri: redirectUri || '',
        grant_type: 'authorization_code'
      })
    })

    const tokenData = await tokenResponse.json()

    if (tokenData.error) {
      throw new Error("Erreur Spotify: " + tokenData.error_description)
    }

    const refreshToken = tokenData.refresh_token

    // 4. On demande à Spotify l'ID de l'utilisateur (pour éviter qu'il pre-save 2 fois)
    const userResponse = await fetch('https://api.spotify.com/v1/me', {
      headers: { 'Authorization': 'Bearer ' + tokenData.access_token }
    })
    const userData = await userResponse.json()
    const spotifyUserId = userData.id

    // 5. Connexion à ta base de données Supabase (avec droits d'Admin / Service Role)
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const supabase = createClient(supabaseUrl || '', supabaseKey || '')

    // 6. On sauvegarde le pre-save dans la table `presaves`
    const { error: dbError } = await supabase
      .from('presaves')
      .insert({
        release_id: releaseId,
        refresh_token: refreshToken,
        spotify_user_id: spotifyUserId
      })

    // Si le fan a déjà pre-save ce son, la DB va renvoyer une erreur de doublon (code 23505)
    if (dbError) {
      if (dbError.code === '23505') {
        return new Response(
          JSON.stringify({ success: true, message: 'Tu as déjà pre-save ce son !' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        )
      }
      throw new Error("Erreur Base de données: " + dbError.message)
    }

    // Succès total !
    return new Response(
      JSON.stringify({ success: true, message: 'Pre-save confirmé !' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})