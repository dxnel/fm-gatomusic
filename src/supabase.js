import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://myocyewsxuycstfeivyi.supabase.co'
const supabaseAnonKey = 'sb_publishable_YpigM47CNT1ngA4AxOWp1A_5g-DBJkb'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)