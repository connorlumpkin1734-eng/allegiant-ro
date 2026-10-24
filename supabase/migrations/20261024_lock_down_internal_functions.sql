-- Internal functions should not be callable through the public API.

-- Rate limiter is only called server-side (Netlify functions) with the service role key.
revoke execute on function public.check_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, integer, integer) to service_role;

-- Trigger-only functions: triggers still fire; these just can't be called via /rest/v1/rpc.
revoke execute on function public.bump_trial_ro_count() from public, anon, authenticated;
revoke execute on function public.enforce_trial_ro_customer_lock() from public, anon, authenticated;
revoke execute on function public.set_default_plan_price() from public, anon, authenticated;
revoke execute on function public.set_repair_order_completed_at() from public, anon, authenticated;
