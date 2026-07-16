// Shared CORS headers for edge functions invoked from the browser
// (admin-create-student). The scheduled sweep functions don't need this
// since they're only ever called by pg_cron, never by a browser.
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
