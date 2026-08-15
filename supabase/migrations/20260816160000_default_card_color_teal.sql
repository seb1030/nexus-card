-- Default card colour: indigo -> teal.
--
-- The client always sends a colour explicitly, so this default is only
-- reached by an insert that omits the column. Changed anyway so the
-- database does not quietly disagree with the app about what a new card
-- looks like -- a default that contradicts the UI is the kind of thing
-- that surfaces years later as "why is this one card the wrong colour".
--
-- Existing rows are deliberately NOT rewritten. cards.color is a choice
-- the user made, including the users who kept the old default, and
-- reassigning it would be changing their card's appearance without
-- asking. Only the value handed to future rows changes.

alter table public.cards alter column color set default '#0891b2';
