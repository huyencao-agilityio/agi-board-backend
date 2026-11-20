-- manual: pg_trgm is needed by the GIN trigram indexes below.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateEnum
CREATE TYPE "activity_type" AS ENUM ('card_created', 'card_copied', 'card_title_changed', 'card_description_changed', 'card_moved', 'card_completed', 'card_reopened', 'card_archived', 'card_restored', 'card_member_added', 'card_member_removed', 'card_label_added', 'card_label_removed', 'card_due_date_set', 'card_dates_changed', 'card_dates_removed', 'card_cover_changed', 'comment_deleted', 'attachment_added', 'attachment_removed', 'checklist_added', 'checklist_renamed', 'checklist_removed', 'checklist_item_added', 'checklist_item_checked', 'checklist_item_unchecked', 'checklist_item_removed', 'link_added', 'link_removed', 'board_created', 'board_renamed', 'board_visibility_changed', 'board_background_changed', 'board_closed', 'board_reopened', 'list_created', 'list_renamed', 'list_moved', 'list_archived', 'list_restored');

-- CreateEnum
CREATE TYPE "audit_action" AS ENUM ('workspace_created', 'role_change', 'removal', 'deactivation', 'reactivation', 'archive', 'restore', 'visibility_change', 'invite', 'board_copy', 'card_move', 'card_copy', 'list_move', 'permanent_deletion', 'system_role_change', 'sign_out_all_sessions', 'resend_verification_code', 'send_password_reset_link');

-- CreateEnum
CREATE TYPE "auth_throttle_scope" AS ENUM ('sign_in', 'change_password', 'reset_email');

-- CreateEnum
CREATE TYPE "board_visibility" AS ENUM ('private', 'workspace');

-- CreateEnum
CREATE TYPE "card_link_type" AS ENUM ('blocks', 'relates_to');

-- CreateEnum
CREATE TYPE "invite_status" AS ENUM ('pending', 'accepted', 'declined', 'revoked');

-- CreateEnum
CREATE TYPE "member_role" AS ENUM ('admin', 'member');

-- CreateEnum
CREATE TYPE "notification_type" AS ENUM ('mention', 'comment', 'added_to_card', 'invite', 'card_moved', 'card_completed', 'blocker_completed', 'system_role_changed', 'due_reminder');

-- CreateEnum
CREATE TYPE "rule_scope" AS ENUM ('workspace_admins', 'board_admins');

-- CreateEnum
CREATE TYPE "session_end_reason" AS ENUM ('logout', 'signed_out_by_user', 'signed_out_by_admin', 'password_reset', 'password_changed');

-- CreateEnum
CREATE TYPE "system_role" AS ENUM ('user', 'support', 'super_admin');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "email" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "avatar_object_key" TEXT,
    "password_hash" TEXT,
    "google_subject" TEXT,
    "email_verified_at" TIMESTAMPTZ(6),
    "system_role" "system_role" NOT NULL DEFAULT 'user',
    "role_before_deactivation" "system_role",
    "deactivated_at" TIMESTAMPTZ(6),
    "deactivated_by_id" UUID,
    "last_sign_in_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_agent" TEXT,
    "ip_address" INET,
    "last_active_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(6),
    "end_reason" "session_end_reason",
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_verification_codes" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "failed_attempts" SMALLINT NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "voided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verification_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "voided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_throttles" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "scope" "auth_throttle_scope" NOT NULL,
    "subject_key" TEXT NOT NULL,
    "failed_count" SMALLINT NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "last_sent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_throttles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "boards" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "workspace_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "visibility" "board_visibility" NOT NULL DEFAULT 'workspace',
    "background_key" TEXT,
    "background_object_key" TEXT,
    "next_card_number" INTEGER NOT NULL DEFAULT 1,
    "closed_at" TIMESTAMPTZ(6),
    "closed_by_id" UUID,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "boards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "board_members" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "board_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "member_role" NOT NULL DEFAULT 'member',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "board_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "board_stars" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "board_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "board_stars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "board_views" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "board_id" UUID NOT NULL,
    "last_viewed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "board_views_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "labels" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "board_id" UUID NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "color_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "labels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lists" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "board_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "pos" DOUBLE PRECISION NOT NULL,
    "archived_at" TIMESTAMPTZ(6),
    "archived_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cards" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "board_id" UUID NOT NULL,
    "list_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "pos" DOUBLE PRECISION NOT NULL,
    "cover_color" TEXT,
    "start_at" TIMESTAMPTZ(6),
    "due_at" TIMESTAMPTZ(6),
    "reminder_offset_minutes" INTEGER,
    "reminder_at" TIMESTAMPTZ(6),
    "reminder_sent_for_due" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "completed_by_id" UUID,
    "archived_at" TIMESTAMPTZ(6),
    "archived_by_id" UUID,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "card_labels" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "card_id" UUID NOT NULL,
    "label_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "card_labels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "card_members" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "card_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "card_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "card_watchers" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "card_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "card_watchers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklists" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "card_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "pos" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checklists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_items" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "checklist_id" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "pos" DOUBLE PRECISION NOT NULL,
    "checked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "card_links" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "source_card_id" UUID NOT NULL,
    "target_card_id" UUID NOT NULL,
    "type" "card_link_type" NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "card_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "card_id" UUID NOT NULL,
    "uploaded_by_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "object_key" TEXT NOT NULL,
    "preview_object_key" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "card_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "edited_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activities" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "board_id" UUID NOT NULL,
    "card_id" UUID,
    "actor_id" UUID NOT NULL,
    "type" "activity_type" NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "label_colors" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hex" TEXT NOT NULL,
    "sort_order" SMALLINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "label_colors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "board_backgrounds" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "image_object_key" TEXT NOT NULL,
    "thumbnail_object_key" TEXT NOT NULL,
    "sort_order" SMALLINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "board_backgrounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "recipient_id" UUID NOT NULL,
    "actor_id" UUID,
    "type" "notification_type" NOT NULL,
    "workspace_id" UUID,
    "card_id" UUID,
    "invite_id" UUID,
    "data" JSONB NOT NULL DEFAULT '{}',
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log_entries" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "workspace_id" UUID,
    "actor_id" UUID NOT NULL,
    "actor_name" TEXT NOT NULL,
    "action" "audit_action" NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" UUID,
    "target_label" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspaces" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "name" TEXT NOT NULL,
    "closed_board_delete_rule" "rule_scope" NOT NULL DEFAULT 'workspace_admins',
    "outside_invite_rule" "rule_scope" NOT NULL DEFAULT 'workspace_admins',
    "archived_at" TIMESTAMPTZ(6),
    "archived_by_id" UUID,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_members" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "member_role" NOT NULL DEFAULT 'member',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invites" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "workspace_id" UUID NOT NULL,
    "board_id" UUID,
    "email" TEXT NOT NULL,
    "role" "member_role" NOT NULL DEFAULT 'member',
    "status" "invite_status" NOT NULL DEFAULT 'pending',
    "invited_by_id" UUID NOT NULL,
    "last_sent_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "responded_at" TIMESTAMPTZ(6),
    "responded_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_google_subject_key" ON "users"("google_subject");

-- CreateIndex
CREATE INDEX "idx_users_active_super_admin" ON "users"("id") WHERE ((system_role = 'super_admin'::system_role) AND (deactivated_at IS NULL));

-- CreateIndex
CREATE INDEX "idx_users_deactivated_by_id" ON "users"("deactivated_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_token_hash_key" ON "user_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "idx_user_sessions_user_active" ON "user_sessions"("user_id", "last_active_at" DESC) WHERE (ended_at IS NULL);

-- CreateIndex
CREATE INDEX "idx_user_sessions_user_id" ON "user_sessions"("user_id");

-- CreateIndex
CREATE INDEX "idx_email_verification_codes_user_id" ON "email_verification_codes"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_email_verification_codes_live" ON "email_verification_codes"("user_id") WHERE ((consumed_at IS NULL) AND (voided_at IS NULL));

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "idx_password_reset_tokens_user_id" ON "password_reset_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_password_reset_tokens_live" ON "password_reset_tokens"("user_id") WHERE ((used_at IS NULL) AND (voided_at IS NULL));

-- CreateIndex
CREATE UNIQUE INDEX "auth_throttles_scope_subject_key_key" ON "auth_throttles"("scope", "subject_key");

-- CreateIndex
CREATE INDEX "idx_boards_background_key" ON "boards"("background_key");

-- CreateIndex
CREATE INDEX "idx_boards_closed_by_id" ON "boards"("closed_by_id");

-- CreateIndex
CREATE INDEX "idx_boards_created_by_id" ON "boards"("created_by_id");

-- CreateIndex
CREATE INDEX "idx_boards_name_trgm" ON "boards" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "idx_boards_workspace_id" ON "boards"("workspace_id");

-- CreateIndex
CREATE INDEX "idx_board_members_board_id" ON "board_members"("board_id");

-- CreateIndex
CREATE INDEX "idx_board_members_user_id" ON "board_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "board_members_board_id_user_id_key" ON "board_members"("board_id", "user_id");

-- CreateIndex
CREATE INDEX "idx_board_stars_board_id" ON "board_stars"("board_id");

-- CreateIndex
CREATE INDEX "idx_board_stars_user_id" ON "board_stars"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "board_stars_user_id_board_id_key" ON "board_stars"("user_id", "board_id");

-- CreateIndex
CREATE INDEX "idx_board_views_board_id" ON "board_views"("board_id");

-- CreateIndex
CREATE INDEX "idx_board_views_user_recent" ON "board_views"("user_id", "last_viewed_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "board_views_user_id_board_id_key" ON "board_views"("user_id", "board_id");

-- CreateIndex
CREATE INDEX "idx_labels_board_id" ON "labels"("board_id");

-- CreateIndex
CREATE INDEX "idx_labels_color_key" ON "labels"("color_key");

-- CreateIndex
CREATE INDEX "idx_lists_archived_by_id" ON "lists"("archived_by_id");

-- CreateIndex
CREATE INDEX "idx_lists_board_archived" ON "lists"("board_id", "archived_at" DESC) WHERE (archived_at IS NOT NULL);

-- CreateIndex
CREATE INDEX "idx_lists_board_id" ON "lists"("board_id");

-- CreateIndex
CREATE INDEX "idx_lists_board_pos_active" ON "lists"("board_id", "pos") WHERE (archived_at IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "lists_id_board_id_key" ON "lists"("id", "board_id");

-- CreateIndex
CREATE INDEX "idx_cards_archived_by_id" ON "cards"("archived_by_id");

-- CreateIndex
CREATE INDEX "idx_cards_board_archived" ON "cards"("board_id", "archived_at" DESC) WHERE (archived_at IS NOT NULL);

-- CreateIndex
CREATE INDEX "idx_cards_board_id" ON "cards"("board_id");

-- CreateIndex
CREATE INDEX "idx_cards_completed_by_id" ON "cards"("completed_by_id");

-- CreateIndex
CREATE INDEX "idx_cards_created_by_id" ON "cards"("created_by_id");

-- CreateIndex
CREATE INDEX "idx_cards_list_id" ON "cards"("list_id");

-- CreateIndex
CREATE INDEX "idx_cards_list_pos_active" ON "cards"("list_id", "pos") WHERE (archived_at IS NULL);

-- CreateIndex
CREATE INDEX "idx_cards_reminder_due" ON "cards"("reminder_at") WHERE ((reminder_at IS NOT NULL) AND (completed_at IS NULL) AND (archived_at IS NULL));

-- CreateIndex
CREATE UNIQUE INDEX "uq_cards_board_number" ON "cards"("board_id", "number");

-- CreateIndex
CREATE INDEX "idx_card_labels_card_id" ON "card_labels"("card_id");

-- CreateIndex
CREATE INDEX "idx_card_labels_label_id" ON "card_labels"("label_id");

-- CreateIndex
CREATE UNIQUE INDEX "card_labels_card_id_label_id_key" ON "card_labels"("card_id", "label_id");

-- CreateIndex
CREATE INDEX "idx_card_members_card_id" ON "card_members"("card_id");

-- CreateIndex
CREATE INDEX "idx_card_members_user_id" ON "card_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "card_members_card_id_user_id_key" ON "card_members"("card_id", "user_id");

-- CreateIndex
CREATE INDEX "idx_card_watchers_card_id" ON "card_watchers"("card_id");

-- CreateIndex
CREATE INDEX "idx_card_watchers_user_id" ON "card_watchers"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "card_watchers_card_id_user_id_key" ON "card_watchers"("card_id", "user_id");

-- CreateIndex
CREATE INDEX "idx_checklists_card_id" ON "checklists"("card_id", "pos");

-- CreateIndex
CREATE INDEX "idx_checklist_items_checklist_id" ON "checklist_items"("checklist_id", "pos");

-- CreateIndex
CREATE INDEX "idx_card_links_created_by_id" ON "card_links"("created_by_id");

-- CreateIndex
CREATE INDEX "idx_card_links_source_card_id" ON "card_links"("source_card_id");

-- CreateIndex
CREATE INDEX "idx_card_links_target_card_id" ON "card_links"("target_card_id");

-- CreateIndex
CREATE UNIQUE INDEX "attachments_object_key_key" ON "attachments"("object_key");

-- CreateIndex
CREATE INDEX "idx_attachments_card_id" ON "attachments"("card_id");

-- CreateIndex
CREATE INDEX "idx_attachments_uploaded_by_id" ON "attachments"("uploaded_by_id");

-- CreateIndex
CREATE INDEX "idx_comments_author_id" ON "comments"("author_id");

-- CreateIndex
CREATE INDEX "idx_comments_card_id" ON "comments"("card_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_activities_actor_id" ON "activities"("actor_id");

-- CreateIndex
CREATE INDEX "idx_activities_board_id" ON "activities"("board_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_activities_card_id" ON "activities"("card_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "label_colors_sort_order_key" ON "label_colors"("sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "board_backgrounds_sort_order_key" ON "board_backgrounds"("sort_order");

-- CreateIndex
CREATE INDEX "idx_notifications_actor_id" ON "notifications"("actor_id");

-- CreateIndex
CREATE INDEX "idx_notifications_card_id" ON "notifications"("card_id");

-- CreateIndex
CREATE INDEX "idx_notifications_invite_id" ON "notifications"("invite_id");

-- CreateIndex
CREATE INDEX "idx_notifications_recipient_recent" ON "notifications"("recipient_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_notifications_recipient_unread" ON "notifications"("recipient_id") WHERE (read_at IS NULL);

-- CreateIndex
CREATE INDEX "idx_notifications_workspace_id" ON "notifications"("workspace_id");

-- CreateIndex
CREATE INDEX "idx_audit_log_entries_actor_id" ON "audit_log_entries"("actor_id");

-- CreateIndex
CREATE INDEX "idx_audit_log_entries_workspace_action" ON "audit_log_entries"("workspace_id", "action", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_audit_log_entries_workspace_id" ON "audit_log_entries"("workspace_id", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "idx_workspaces_archived_by_id" ON "workspaces"("archived_by_id");

-- CreateIndex
CREATE INDEX "idx_workspaces_created_by_id" ON "workspaces"("created_by_id");

-- CreateIndex
CREATE INDEX "idx_workspace_members_admins" ON "workspace_members"("workspace_id") WHERE (role = 'admin'::member_role);

-- CreateIndex
CREATE INDEX "idx_workspace_members_user_id" ON "workspace_members"("user_id");

-- CreateIndex
CREATE INDEX "idx_workspace_members_workspace_id" ON "workspace_members"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_members_workspace_id_user_id_key" ON "workspace_members"("workspace_id", "user_id");

-- CreateIndex
CREATE INDEX "idx_invites_board_id" ON "invites"("board_id");

-- CreateIndex
CREATE INDEX "idx_invites_invited_by_id" ON "invites"("invited_by_id");

-- CreateIndex
CREATE INDEX "idx_invites_pending_email" ON "invites"("email") WHERE (status = 'pending'::invite_status);

-- CreateIndex
CREATE INDEX "idx_invites_responded_by_id" ON "invites"("responded_by_id");

-- CreateIndex
CREATE INDEX "idx_invites_workspace_id" ON "invites"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_invites_pending_target" ON "invites"("workspace_id", "board_id", "email") WHERE (status = 'pending'::invite_status);

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_deactivated_by_id_fkey" FOREIGN KEY ("deactivated_by_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "email_verification_codes" ADD CONSTRAINT "email_verification_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "boards" ADD CONSTRAINT "boards_background_key_fkey" FOREIGN KEY ("background_key") REFERENCES "board_backgrounds"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "boards" ADD CONSTRAINT "boards_closed_by_id_fkey" FOREIGN KEY ("closed_by_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "boards" ADD CONSTRAINT "boards_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "boards" ADD CONSTRAINT "boards_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "board_members" ADD CONSTRAINT "board_members_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "board_members" ADD CONSTRAINT "board_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "board_stars" ADD CONSTRAINT "board_stars_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "board_stars" ADD CONSTRAINT "board_stars_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "board_views" ADD CONSTRAINT "board_views_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "board_views" ADD CONSTRAINT "board_views_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "labels" ADD CONSTRAINT "labels_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "labels" ADD CONSTRAINT "labels_color_key_fkey" FOREIGN KEY ("color_key") REFERENCES "label_colors"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "lists" ADD CONSTRAINT "lists_archived_by_id_fkey" FOREIGN KEY ("archived_by_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "lists" ADD CONSTRAINT "lists_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cards" ADD CONSTRAINT "cards_archived_by_id_fkey" FOREIGN KEY ("archived_by_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cards" ADD CONSTRAINT "cards_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cards" ADD CONSTRAINT "cards_completed_by_id_fkey" FOREIGN KEY ("completed_by_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cards" ADD CONSTRAINT "cards_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cards" ADD CONSTRAINT "cards_list_id_board_id_fkey" FOREIGN KEY ("list_id", "board_id") REFERENCES "lists"("id", "board_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_labels" ADD CONSTRAINT "card_labels_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "card_labels" ADD CONSTRAINT "card_labels_label_id_fkey" FOREIGN KEY ("label_id") REFERENCES "labels"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "card_members" ADD CONSTRAINT "card_members_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "card_members" ADD CONSTRAINT "card_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "card_watchers" ADD CONSTRAINT "card_watchers_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "card_watchers" ADD CONSTRAINT "card_watchers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "checklists" ADD CONSTRAINT "checklists_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_checklist_id_fkey" FOREIGN KEY ("checklist_id") REFERENCES "checklists"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "card_links" ADD CONSTRAINT "card_links_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "card_links" ADD CONSTRAINT "card_links_source_card_id_fkey" FOREIGN KEY ("source_card_id") REFERENCES "cards"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "card_links" ADD CONSTRAINT "card_links_target_card_id_fkey" FOREIGN KEY ("target_card_id") REFERENCES "cards"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_invite_id_fkey" FOREIGN KEY ("invite_id") REFERENCES "invites"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "audit_log_entries" ADD CONSTRAINT "audit_log_entries_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "audit_log_entries" ADD CONSTRAINT "audit_log_entries_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_archived_by_id_fkey" FOREIGN KEY ("archived_by_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "invites" ADD CONSTRAINT "invites_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "invites" ADD CONSTRAINT "invites_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "invites" ADD CONSTRAINT "invites_responded_by_id_fkey" FOREIGN KEY ("responded_by_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "invites" ADD CONSTRAINT "invites_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- =====================================================================
-- manual: objects Prisma schema cannot express. Source: docs/database/schema.sql.
-- Keep in sync by hand; check every new migration does not drop them.
-- =====================================================================

-- manual: CHECK constraints
ALTER TABLE activities ADD CONSTRAINT activities_check CHECK (((card_id IS NULL) = (((type)::text ~~ 'board\_%'::text) OR ((type)::text ~~ 'list\_%'::text))));
ALTER TABLE attachments ADD CONSTRAINT attachments_size_bytes_check CHECK (((size_bytes >= 0) AND (size_bytes <= 26214400)));
ALTER TABLE boards ADD CONSTRAINT boards_check CHECK (((background_key IS NULL) OR (background_object_key IS NULL)));
ALTER TABLE boards ADD CONSTRAINT boards_name_check CHECK ((btrim(name) <> ''::text));
ALTER TABLE card_links ADD CONSTRAINT card_links_check CHECK ((source_card_id <> target_card_id));
ALTER TABLE cards ADD CONSTRAINT cards_check CHECK (((start_at IS NULL) OR (due_at IS NULL) OR (start_at < due_at)));
ALTER TABLE cards ADD CONSTRAINT cards_check1 CHECK (((reminder_offset_minutes IS NULL) OR (due_at IS NOT NULL)));
ALTER TABLE cards ADD CONSTRAINT cards_check2 CHECK (((reminder_at IS NULL) = (reminder_offset_minutes IS NULL)));
ALTER TABLE cards ADD CONSTRAINT cards_reminder_offset_minutes_check CHECK ((reminder_offset_minutes = ANY (ARRAY[0, 1440, 2880])));
ALTER TABLE cards ADD CONSTRAINT cards_title_check CHECK ((btrim(title) <> ''::text));
ALTER TABLE checklist_items ADD CONSTRAINT checklist_items_text_check CHECK ((btrim(text) <> ''::text));
ALTER TABLE checklists ADD CONSTRAINT checklists_title_check CHECK ((btrim(title) <> ''::text));
ALTER TABLE comments ADD CONSTRAINT comments_body_check CHECK ((btrim(body) <> ''::text));
ALTER TABLE email_verification_codes ADD CONSTRAINT email_verification_codes_failed_attempts_check CHECK (((failed_attempts >= 0) AND (failed_attempts <= 5)));
ALTER TABLE invites ADD CONSTRAINT invites_email_check CHECK ((email = lower(btrim(email))));
ALTER TABLE label_colors ADD CONSTRAINT label_colors_hex_check CHECK ((hex ~ '^#[0-9A-Fa-f]{6}$'::text));
ALTER TABLE lists ADD CONSTRAINT lists_name_check CHECK ((btrim(name) <> ''::text));
ALTER TABLE users ADD CONSTRAINT users_check CHECK (((password_hash IS NOT NULL) OR (google_subject IS NOT NULL)));
ALTER TABLE users ADD CONSTRAINT users_check1 CHECK (((deactivated_at IS NULL) OR (system_role = 'user'::system_role)));
ALTER TABLE users ADD CONSTRAINT users_email_check CHECK ((email = lower(btrim(email))));
ALTER TABLE users ADD CONSTRAINT users_full_name_check CHECK ((btrim(full_name) <> ''::text));
ALTER TABLE user_sessions ADD CONSTRAINT user_sessions_check CHECK (((ended_at IS NULL) = (end_reason IS NULL)));
ALTER TABLE workspaces ADD CONSTRAINT workspaces_name_check CHECK ((btrim(name) <> ''::text));

-- manual: expression indexes
CREATE INDEX idx_users_full_name ON users (lower(full_name));
CREATE INDEX idx_users_search_trgm ON users USING gin ((full_name || ' ' || email) gin_trgm_ops);
CREATE INDEX idx_boards_workspace_open ON boards (workspace_id, lower(name)) WHERE closed_at IS NULL;
CREATE INDEX idx_cards_search_trgm ON cards USING gin ((title || ' ' || coalesce(description, '')) gin_trgm_ops);
-- A link between two cards is unique regardless of direction.
CREATE UNIQUE INDEX uq_card_links_pair ON card_links (LEAST(source_card_id, target_card_id), GREATEST(source_card_id, target_card_id));

-- manual: one pending invite per (workspace, board or none, email); NULL board_id must collide too.
DROP INDEX uq_invites_pending_target;
CREATE UNIQUE INDEX uq_invites_pending_target ON invites (workspace_id, board_id, email) NULLS NOT DISTINCT WHERE status = 'pending';

-- manual: card numbers are swapped inside one transaction when copying/moving, so the check is deferred.
DROP INDEX uq_cards_board_number;
ALTER TABLE cards ADD CONSTRAINT uq_cards_board_number UNIQUE (board_id, number) DEFERRABLE INITIALLY DEFERRED;
