
DROP POLICY IF EXISTS "Users manage own keys" ON public.api_keys;
CREATE POLICY "Users manage own keys" ON public.api_keys
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own ai settings" ON public.user_ai_settings;
CREATE POLICY "Users manage own ai settings" ON public.user_ai_settings
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own chat uploads" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'chat-uploads' AND auth.uid()::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id = 'chat-uploads' AND auth.uid()::text = (storage.foldername(name))[1]);
