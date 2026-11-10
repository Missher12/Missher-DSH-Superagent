/** Deliberate read-only Project Ops integration; task execution remains owned by Superagent. */
export const PROJECT_OPS_READ_TOOLS = ['missher_project_ops_doctor', 'missher_project_ops_capability_search',
  'missher_project_ops_task_list', 'missher_project_ops_document_read'] as const
export const PROJECT_OPS_OTHER_TOOLS = ['missher_project_ops_document_write', 'missher_project_ops_task_plan',
  'missher_project_ops_task_run', 'missher_project_ops_task_collect', 'missher_project_ops_verification_gate'] as const
