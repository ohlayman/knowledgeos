-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('file', 'url', 'manual', 'github', 'rss', 'notion');

-- CreateEnum
CREATE TYPE "VersionStatus" AS ENUM ('queued', 'processing', 'ready', 'failed', 'needs_ocr', 'expired');

-- CreateEnum
CREATE TYPE "ChunkType" AS ENUM ('text', 'code', 'table', 'list');

-- CreateEnum
CREATE TYPE "VectorStatus" AS ENUM ('pending', 'ready', 'failed');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('ingest', 'reparse', 'extract', 'wiki_compile', 'maintenance');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('queued', 'running', 'succeeded', 'failed', 'canceled', 'expired');

-- CreateEnum
CREATE TYPE "JobStepName" AS ENUM ('parse', 'clean', 'metadata', 'dedupe', 'chunk', 'embed', 'index');

-- CreateEnum
CREATE TYPE "StepStatus" AS ENUM ('pending', 'running', 'succeeded', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('user', 'assistant', 'system');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('pending', 'streaming', 'complete', 'stopped', 'failed');

-- CreateEnum
CREATE TYPE "FeedbackType" AS ENUM ('helpful', 'not_helpful', 'citation_wrong');

-- CreateEnum
CREATE TYPE "ProviderKind" AS ENUM ('llm', 'embedding', 'rerank');

-- CreateEnum
CREATE TYPE "WikiPageType" AS ENUM ('concept', 'technology', 'project', 'comparison', 'research', 'source');

-- CreateEnum
CREATE TYPE "WikiPageStatus" AS ENUM ('draft', 'proposed', 'published', 'archived', 'stale');

-- CreateEnum
CREATE TYPE "EditorType" AS ENUM ('model', 'human', 'system');

-- CreateEnum
CREATE TYPE "ProposalChangeType" AS ENUM ('create', 'update', 'merge_suggestion', 'mark_stale');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('pending', 'accepted', 'rejected', 'expired', 'invalid');

-- CreateEnum
CREATE TYPE "ReviewTaskType" AS ENUM ('proposal', 'stale_review', 'conflict');

-- CreateEnum
CREATE TYPE "ReviewTaskStatus" AS ENUM ('open', 'in_progress', 'resolved', 'dismissed');

-- CreateEnum
CREATE TYPE "EntityType" AS ENUM ('concept', 'technology', 'project', 'agent', 'protocol');

-- CreateEnum
CREATE TYPE "EntityStatus" AS ENUM ('active', 'merged', 'archived');

-- CreateEnum
CREATE TYPE "RelationType" AS ENUM ('RELATED_TO', 'DEPENDS_ON', 'USES', 'IMPLEMENTS', 'REFERENCES', 'PART_OF', 'COMPETES_WITH', 'EXTENDS', 'CONFLICTS_WITH');

-- CreateEnum
CREATE TYPE "Direction" AS ENUM ('directed', 'undirected');

-- CreateEnum
CREATE TYPE "RelationOrigin" AS ENUM ('extracted', 'human', 'conflict');

-- CreateEnum
CREATE TYPE "RelationStatus" AS ENUM ('active', 'pending', 'rejected');

-- CreateEnum
CREATE TYPE "AgentStatus" AS ENUM ('active', 'archived');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('queued', 'running', 'succeeded', 'failed', 'canceled');

-- CreateEnum
CREATE TYPE "RunStepType" AS ENUM ('thought', 'tool_call', 'output');

-- CreateEnum
CREATE TYPE "ToolCallStatus" AS ENUM ('succeeded', 'failed');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_configs" (
    "id" UUID NOT NULL,
    "kind" "ProviderKind" NOT NULL,
    "provider" VARCHAR(64) NOT NULL,
    "model" VARCHAR(127) NOT NULL,
    "base_url" TEXT,
    "api_key_encrypted" TEXT,
    "api_key_last4" VARCHAR(8),
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "is_draft" BOOLEAN NOT NULL DEFAULT true,
    "extra" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "provider_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_settings" (
    "key" VARCHAR(128) NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "key" VARCHAR(200) NOT NULL,
    "scope" VARCHAR(64) NOT NULL,
    "request_hash" VARCHAR(64) NOT NULL,
    "status_code" INTEGER NOT NULL,
    "response" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "system_events" (
    "id" UUID NOT NULL,
    "level" VARCHAR(16) NOT NULL,
    "type" VARCHAR(64) NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_counters" (
    "id" UUID NOT NULL,
    "scope" VARCHAR(32) NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "date" VARCHAR(10) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "tokens" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "usage_counters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sources" (
    "id" UUID NOT NULL,
    "type" "SourceType" NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "title" TEXT,
    "metadata" JSONB,
    "first_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "owner_id" UUID,
    "title" TEXT NOT NULL,
    "current_version_id" UUID,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_sources" (
    "document_id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "first_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_sources_pkey" PRIMARY KEY ("document_id","source_id")
);

-- CreateTable
CREATE TABLE "document_versions" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "source_id" UUID,
    "version_no" INTEGER NOT NULL,
    "content_hash" VARCHAR(64) NOT NULL,
    "file_hash" VARCHAR(64),
    "status" "VersionStatus" NOT NULL DEFAULT 'queued',
    "is_current" BOOLEAN NOT NULL DEFAULT false,
    "storage_key" TEXT,
    "storage_size" INTEGER,
    "mime_type" VARCHAR(127),
    "original_filename" TEXT,
    "normalized_text" TEXT,
    "char_count" INTEGER NOT NULL DEFAULT 0,
    "page_count" INTEGER,
    "language" VARCHAR(16),
    "metadata" JSONB,
    "parse_warnings" JSONB,
    "suspicious_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "ready_at" TIMESTAMPTZ(3),

    CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chunks" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "token_count" INTEGER NOT NULL,
    "start_offset" INTEGER NOT NULL,
    "end_offset" INTEGER NOT NULL,
    "page_start" INTEGER,
    "page_end" INTEGER,
    "heading_path" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "type" "ChunkType" NOT NULL DEFAULT 'text',
    "location" JSONB,
    "search_text" TEXT NOT NULL,
    "vector_status" "VectorStatus" NOT NULL DEFAULT 'pending',
    "embedding_model" VARCHAR(127),
    "embedding_dim" INTEGER,
    "suspicious" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processing_jobs" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "type" "JobType" NOT NULL DEFAULT 'ingest',
    "status" "JobStatus" NOT NULL DEFAULT 'queued',
    "current_step" "JobStepName",
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "error_code" VARCHAR(64),
    "error_message" TEXT,
    "error_stack" TEXT,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "processing_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_steps" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "step" "JobStepName" NOT NULL,
    "step_order" INTEGER NOT NULL,
    "status" "StepStatus" NOT NULL DEFAULT 'pending',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "input_summary" JSONB,
    "output_summary" JSONB,
    "error_code" VARCHAR(64),
    "error_message" TEXT,
    "error_stack" TEXT,
    "metadata" JSONB,

    CONSTRAINT "job_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "owner_id" UUID,
    "title" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'pending',
    "client_message_id" VARCHAR(128),
    "model" VARCHAR(127),
    "prompt_version" VARCHAR(64),
    "token_usage" JSONB,
    "citation_check" JSONB,
    "error_code" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "citations" (
    "id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "chunk_id" UUID,
    "document_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "quote" TEXT NOT NULL,
    "start_offset" INTEGER,
    "end_offset" INTEGER,
    "is_valid" BOOLEAN NOT NULL DEFAULT true,
    "validation_error" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "citations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_feedback" (
    "id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "type" "FeedbackType" NOT NULL,
    "citation_ordinal" INTEGER,
    "comment" TEXT,
    "snapshot" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "message_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retrieval_runs" (
    "id" UUID NOT NULL,
    "message_id" UUID,
    "query" TEXT NOT NULL,
    "rewritten_query" TEXT,
    "question_type" VARCHAR(32),
    "entities" JSONB,
    "config" JSONB,
    "vector_results" JSONB,
    "keyword_results" JSONB,
    "fused_results" JSONB,
    "reranked_results" JSONB,
    "final_chunk_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "degraded" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "duration_ms" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "retrieval_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wiki_pages" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(255) NOT NULL,
    "title" TEXT NOT NULL,
    "type" "WikiPageType" NOT NULL,
    "status" "WikiPageStatus" NOT NULL DEFAULT 'draft',
    "summary" TEXT,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "confidence" DOUBLE PRECISION,
    "current_revision_id" UUID,
    "last_reviewed_at" TIMESTAMPTZ(3),
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "wiki_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wiki_revisions" (
    "id" UUID NOT NULL,
    "page_id" UUID NOT NULL,
    "revision_no" INTEGER NOT NULL,
    "parent_revision_id" UUID,
    "editor_type" "EditorType" NOT NULL,
    "change_summary" TEXT,
    "content" JSONB NOT NULL,
    "evidence_chunk_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "diff_stat" JSONB,
    "proposal_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wiki_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wiki_proposals" (
    "id" UUID NOT NULL,
    "target_page_id" UUID,
    "change_type" "ProposalChangeType" NOT NULL,
    "base_revision_id" UUID,
    "dedupe_key" VARCHAR(64) NOT NULL,
    "patch" JSONB NOT NULL,
    "evidence" JSONB NOT NULL,
    "conflicts" JSONB,
    "validation" JSONB,
    "status" "ProposalStatus" NOT NULL DEFAULT 'pending',
    "document_version_id" UUID,
    "model_meta" JSONB,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "reject_reason" VARCHAR(64),
    "reject_comment" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3),

    CONSTRAINT "wiki_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wiki_links" (
    "id" UUID NOT NULL,
    "from_page_id" UUID NOT NULL,
    "to_page_id" UUID,
    "target_slug" VARCHAR(255) NOT NULL,
    "relation_type" VARCHAR(32),
    "context" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wiki_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entities" (
    "id" UUID NOT NULL,
    "canonical_name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "type" "EntityType" NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source_chunk_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "mention_count" INTEGER NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "EntityStatus" NOT NULL DEFAULT 'active',
    "merged_into_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entity_mentions" (
    "id" UUID NOT NULL,
    "entity_id" UUID NOT NULL,
    "chunk_id" UUID NOT NULL,
    "start_offset" INTEGER NOT NULL,
    "end_offset" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entity_mentions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "relations" (
    "id" UUID NOT NULL,
    "from_entity_id" UUID NOT NULL,
    "to_entity_id" UUID NOT NULL,
    "type" "RelationType" NOT NULL,
    "direction" "Direction" NOT NULL DEFAULT 'directed',
    "evidence_chunk_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "origin" "RelationOrigin" NOT NULL DEFAULT 'extracted',
    "status" "RelationStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "relations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "facts" (
    "id" UUID NOT NULL,
    "subject_entity_id" UUID NOT NULL,
    "predicate" VARCHAR(128) NOT NULL,
    "value_text" TEXT NOT NULL,
    "value_type" VARCHAR(32),
    "evidence_chunk_id" UUID NOT NULL,
    "captured_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "identity_hash" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "facts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_tasks" (
    "id" UUID NOT NULL,
    "type" "ReviewTaskType" NOT NULL,
    "target_type" VARCHAR(32) NOT NULL,
    "target_id" UUID NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "status" "ReviewTaskStatus" NOT NULL DEFAULT 'open',
    "proposal_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(3),

    CONSTRAINT "review_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extraction_cache" (
    "id" UUID NOT NULL,
    "chunk_id" UUID NOT NULL,
    "model" VARCHAR(127) NOT NULL,
    "prompt_version" VARCHAR(64) NOT NULL,
    "result" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "extraction_cache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agents" (
    "id" UUID NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "description" TEXT,
    "status" "AgentStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_versions" (
    "id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "version_no" INTEGER NOT NULL,
    "system_prompt" TEXT NOT NULL,
    "model" VARCHAR(127) NOT NULL,
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.2,
    "tool_allowlist" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "max_steps" INTEGER NOT NULL DEFAULT 8,
    "token_budget" INTEGER NOT NULL DEFAULT 20000,
    "tool_call_budget" INTEGER NOT NULL DEFAULT 12,
    "allow_proposal" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_runs" (
    "id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "agent_version_id" UUID NOT NULL,
    "trigger" VARCHAR(32) NOT NULL,
    "input" JSONB NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'queued',
    "total_steps" INTEGER NOT NULL DEFAULT 0,
    "total_tokens" INTEGER NOT NULL DEFAULT 0,
    "duration_ms" INTEGER,
    "termination_reason" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),

    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "run_steps" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "step_index" INTEGER NOT NULL,
    "type" "RunStepType" NOT NULL,
    "output_summary" TEXT,
    "duration_ms" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "run_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tool_calls" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "step_index" INTEGER NOT NULL,
    "tool_name" VARCHAR(64) NOT NULL,
    "params_redacted" JSONB NOT NULL,
    "result_summary" TEXT,
    "status" "ToolCallStatus" NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "error_code" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tool_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mcp_tokens" (
    "id" UUID NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "token_prefix" VARCHAR(16) NOT NULL,
    "document_scope" JSONB,
    "tool_allowlist" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "daily_limit" INTEGER NOT NULL DEFAULT 500,
    "qps_limit" INTEGER NOT NULL DEFAULT 5,
    "expires_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "last_used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mcp_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mcp_audit_logs" (
    "id" UUID NOT NULL,
    "token_id" UUID,
    "tool" VARCHAR(64) NOT NULL,
    "params_summary" JSONB,
    "result_count" INTEGER,
    "duration_ms" INTEGER NOT NULL,
    "status_code" INTEGER NOT NULL,
    "transport" VARCHAR(16) NOT NULL,
    "suspicious" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mcp_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "provider_configs_kind_is_active_idx" ON "provider_configs"("kind", "is_active");

-- CreateIndex
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys"("expires_at");

-- CreateIndex
CREATE INDEX "system_events_type_created_at_idx" ON "system_events"("type", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "usage_counters_scope_key_date_key" ON "usage_counters"("scope", "key", "date");

-- CreateIndex
CREATE UNIQUE INDEX "sources_type_fingerprint_key" ON "sources"("type", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "documents_current_version_id_key" ON "documents"("current_version_id");

-- CreateIndex
CREATE INDEX "documents_is_deleted_updated_at_idx" ON "documents"("is_deleted", "updated_at");

-- CreateIndex
CREATE INDEX "documents_title_idx" ON "documents"("title");

-- CreateIndex
CREATE INDEX "document_sources_source_id_idx" ON "document_sources"("source_id");

-- CreateIndex
CREATE INDEX "document_versions_document_id_is_current_idx" ON "document_versions"("document_id", "is_current");

-- CreateIndex
CREATE INDEX "document_versions_status_idx" ON "document_versions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "document_versions_document_id_version_no_key" ON "document_versions"("document_id", "version_no");

-- CreateIndex
CREATE UNIQUE INDEX "document_versions_document_id_content_hash_key" ON "document_versions"("document_id", "content_hash");

-- CreateIndex
CREATE INDEX "chunks_document_id_idx" ON "chunks"("document_id");

-- CreateIndex
CREATE INDEX "chunks_version_id_vector_status_idx" ON "chunks"("version_id", "vector_status");

-- CreateIndex
CREATE UNIQUE INDEX "chunks_version_id_chunk_index_key" ON "chunks"("version_id", "chunk_index");

-- CreateIndex
CREATE INDEX "processing_jobs_status_created_at_idx" ON "processing_jobs"("status", "created_at");

-- CreateIndex
CREATE INDEX "processing_jobs_version_id_status_idx" ON "processing_jobs"("version_id", "status");

-- CreateIndex
CREATE INDEX "job_steps_job_id_step_order_idx" ON "job_steps"("job_id", "step_order");

-- CreateIndex
CREATE UNIQUE INDEX "job_steps_job_id_step_key" ON "job_steps"("job_id", "step");

-- CreateIndex
CREATE INDEX "conversations_owner_id_updated_at_idx" ON "conversations"("owner_id", "updated_at");

-- CreateIndex
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "messages_status_idx" ON "messages"("status");

-- CreateIndex
CREATE UNIQUE INDEX "messages_conversation_id_client_message_id_key" ON "messages"("conversation_id", "client_message_id");

-- CreateIndex
CREATE INDEX "citations_chunk_id_idx" ON "citations"("chunk_id");

-- CreateIndex
CREATE UNIQUE INDEX "citations_message_id_ordinal_key" ON "citations"("message_id", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "message_feedback_message_id_key" ON "message_feedback"("message_id");

-- CreateIndex
CREATE UNIQUE INDEX "retrieval_runs_message_id_key" ON "retrieval_runs"("message_id");

-- CreateIndex
CREATE INDEX "retrieval_runs_created_at_idx" ON "retrieval_runs"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "wiki_pages_slug_key" ON "wiki_pages"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "wiki_pages_current_revision_id_key" ON "wiki_pages"("current_revision_id");

-- CreateIndex
CREATE INDEX "wiki_pages_type_status_idx" ON "wiki_pages"("type", "status");

-- CreateIndex
CREATE INDEX "wiki_revisions_page_id_created_at_idx" ON "wiki_revisions"("page_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "wiki_revisions_page_id_revision_no_key" ON "wiki_revisions"("page_id", "revision_no");

-- CreateIndex
CREATE UNIQUE INDEX "wiki_proposals_dedupe_key_key" ON "wiki_proposals"("dedupe_key");

-- CreateIndex
CREATE INDEX "wiki_proposals_status_created_at_idx" ON "wiki_proposals"("status", "created_at");

-- CreateIndex
CREATE INDEX "wiki_proposals_target_page_id_status_idx" ON "wiki_proposals"("target_page_id", "status");

-- CreateIndex
CREATE INDEX "wiki_links_to_page_id_idx" ON "wiki_links"("to_page_id");

-- CreateIndex
CREATE INDEX "wiki_links_target_slug_idx" ON "wiki_links"("target_slug");

-- CreateIndex
CREATE INDEX "entities_type_status_idx" ON "entities"("type", "status");

-- CreateIndex
CREATE INDEX "entities_normalized_name_idx" ON "entities"("normalized_name");

-- CreateIndex
CREATE INDEX "entity_mentions_chunk_id_idx" ON "entity_mentions"("chunk_id");

-- CreateIndex
CREATE UNIQUE INDEX "entity_mentions_entity_id_chunk_id_start_offset_key" ON "entity_mentions"("entity_id", "chunk_id", "start_offset");

-- CreateIndex
CREATE INDEX "relations_from_entity_id_type_status_idx" ON "relations"("from_entity_id", "type", "status");

-- CreateIndex
CREATE INDEX "relations_to_entity_id_type_status_idx" ON "relations"("to_entity_id", "type", "status");

-- CreateIndex
CREATE INDEX "facts_identity_hash_idx" ON "facts"("identity_hash");

-- CreateIndex
CREATE UNIQUE INDEX "facts_subject_entity_id_predicate_value_text_evidence_chunk_key" ON "facts"("subject_entity_id", "predicate", "value_text", "evidence_chunk_id");

-- CreateIndex
CREATE INDEX "review_tasks_status_priority_created_at_idx" ON "review_tasks"("status", "priority", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "extraction_cache_chunk_id_model_prompt_version_key" ON "extraction_cache"("chunk_id", "model", "prompt_version");

-- CreateIndex
CREATE UNIQUE INDEX "agent_versions_agent_id_version_no_key" ON "agent_versions"("agent_id", "version_no");

-- CreateIndex
CREATE INDEX "agent_runs_agent_id_created_at_idx" ON "agent_runs"("agent_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "run_steps_run_id_step_index_key" ON "run_steps"("run_id", "step_index");

-- CreateIndex
CREATE INDEX "tool_calls_run_id_step_index_idx" ON "tool_calls"("run_id", "step_index");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_tokens_token_hash_key" ON "mcp_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "mcp_tokens_revoked_at_expires_at_idx" ON "mcp_tokens"("revoked_at", "expires_at");

-- CreateIndex
CREATE INDEX "mcp_audit_logs_token_id_created_at_idx" ON "mcp_audit_logs"("token_id", "created_at");

-- CreateIndex
CREATE INDEX "mcp_audit_logs_created_at_idx" ON "mcp_audit_logs"("created_at");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_current_version_id_fkey" FOREIGN KEY ("current_version_id") REFERENCES "document_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_sources" ADD CONSTRAINT "document_sources_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_sources" ADD CONSTRAINT "document_sources_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "document_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "document_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_steps" ADD CONSTRAINT "job_steps_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "processing_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citations" ADD CONSTRAINT "citations_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citations" ADD CONSTRAINT "citations_chunk_id_fkey" FOREIGN KEY ("chunk_id") REFERENCES "chunks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_feedback" ADD CONSTRAINT "message_feedback_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retrieval_runs" ADD CONSTRAINT "retrieval_runs_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_pages" ADD CONSTRAINT "wiki_pages_current_revision_id_fkey" FOREIGN KEY ("current_revision_id") REFERENCES "wiki_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_revisions" ADD CONSTRAINT "wiki_revisions_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "wiki_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_revisions" ADD CONSTRAINT "wiki_revisions_parent_revision_id_fkey" FOREIGN KEY ("parent_revision_id") REFERENCES "wiki_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_revisions" ADD CONSTRAINT "wiki_revisions_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "wiki_proposals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_proposals" ADD CONSTRAINT "wiki_proposals_target_page_id_fkey" FOREIGN KEY ("target_page_id") REFERENCES "wiki_pages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_proposals" ADD CONSTRAINT "wiki_proposals_base_revision_id_fkey" FOREIGN KEY ("base_revision_id") REFERENCES "wiki_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_proposals" ADD CONSTRAINT "wiki_proposals_document_version_id_fkey" FOREIGN KEY ("document_version_id") REFERENCES "document_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_links" ADD CONSTRAINT "wiki_links_from_page_id_fkey" FOREIGN KEY ("from_page_id") REFERENCES "wiki_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_links" ADD CONSTRAINT "wiki_links_to_page_id_fkey" FOREIGN KEY ("to_page_id") REFERENCES "wiki_pages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entities" ADD CONSTRAINT "entities_merged_into_id_fkey" FOREIGN KEY ("merged_into_id") REFERENCES "entities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_mentions" ADD CONSTRAINT "entity_mentions_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_mentions" ADD CONSTRAINT "entity_mentions_chunk_id_fkey" FOREIGN KEY ("chunk_id") REFERENCES "chunks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relations" ADD CONSTRAINT "relations_from_entity_id_fkey" FOREIGN KEY ("from_entity_id") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relations" ADD CONSTRAINT "relations_to_entity_id_fkey" FOREIGN KEY ("to_entity_id") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facts" ADD CONSTRAINT "facts_subject_entity_id_fkey" FOREIGN KEY ("subject_entity_id") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_tasks" ADD CONSTRAINT "review_tasks_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "wiki_proposals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_versions" ADD CONSTRAINT "agent_versions_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_agent_version_id_fkey" FOREIGN KEY ("agent_version_id") REFERENCES "agent_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_steps" ADD CONSTRAINT "run_steps_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_audit_logs" ADD CONSTRAINT "mcp_audit_logs_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "mcp_tokens"("id") ON DELETE SET NULL ON UPDATE CASCADE;
