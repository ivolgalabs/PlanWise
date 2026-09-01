-- «Когда-нибудь»: мягкий срок выполнения (epoch-day). NULL = «без срока»,
-- N = задача должна быть сделана к этому дню (чип в «Когда-нибудь» + сортировка).
ALTER TABLE tasks ADD COLUMN due_epoch_day INTEGER;
