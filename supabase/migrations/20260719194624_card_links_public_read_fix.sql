-- card_links has no sensitive fields (label/url/clicks are meant to be
-- publicly visible on the card), so anyone may read them. Write access
-- stays restricted to the owner policy from the previous migration.
create policy "public can view card links" on card_links
  for select using (true);
