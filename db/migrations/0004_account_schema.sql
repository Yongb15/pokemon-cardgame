CREATE SCHEMA "account";
--> statement-breakpoint
CREATE TABLE "account"."oauth_accounts" (
	"provider" text NOT NULL,
	"subject" text NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_accounts_provider_subject_pk" PRIMARY KEY("provider","subject"),
	CONSTRAINT "oauth_accounts_provider_check" CHECK (provider in ('google', 'kakao', 'test')),
	CONSTRAINT "oauth_accounts_subject_check" CHECK (char_length(subject) between 1 and 255)
);
--> statement-breakpoint
CREATE TABLE "account"."sessions" (
	"token_hash" "bytea" PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_check" CHECK (octet_length(token_hash) = 32),
	CONSTRAINT "sessions_expiry_check" CHECK (expires_at <= created_at + interval '90 days')
);
--> statement-breakpoint
CREATE TABLE "account"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nickname" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_nickname_check" CHECK (char_length(nickname) between 2 and 20)
);
--> statement-breakpoint
ALTER TABLE "account"."oauth_accounts" ADD CONSTRAINT "oauth_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "account"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account"."sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "account"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "oauth_accounts_user_idx" ON "account"."oauth_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "account"."sessions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "account"."sessions" USING btree ("expires_at");