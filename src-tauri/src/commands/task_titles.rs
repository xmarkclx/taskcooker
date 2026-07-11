use std::process::{Command, Output, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};

use crate::core::{expand_home_alias, AppDb, AppSettingsSummary, AppSnapshot};

use super::{
    command_error, emit_todo_changed, required_command_text, shell_join, CreateTodoCommand,
    ProcessCommandSpec,
};

const CODEX_SPARK_MODEL: &str = "gpt-5.3-codex-spark";
const TASK_TITLE_GENERATION_TIMEOUT: Duration = Duration::from_secs(45);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TaskTitleGenerationRequest {
    pub working_directory: String,
    pub description_markdown: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingTaskTitleGeneration {
    pub todo_id: i64,
    pub expected_title: String,
    pub request: TaskTitleGenerationRequest,
}

pub fn create_todo_in_db(db: &AppDb, input: CreateTodoCommand) -> Result<AppSnapshot, String> {
    let (snapshot, _) = create_todo_in_db_with_pending_title_generation(db, input)?;
    Ok(snapshot)
}

pub(super) fn create_todo_in_db_with_pending_title_generation(
    db: &AppDb,
    input: CreateTodoCommand,
) -> Result<(AppSnapshot, Option<PendingTaskTitleGeneration>), String> {
    let description_markdown = input.description_markdown.unwrap_or_default();
    let title_is_blank = input.title.trim().is_empty();
    let title = if title_is_blank {
        local_fallback_task_title(&description_markdown)
    } else {
        required_command_text("task title", &input.title)?
    };
    let pending_request = if title_is_blank {
        pending_title_generation_request(db, input.project_id, &description_markdown)?
    } else {
        None
    };

    let todo = db
        .create_todo_with_position(
            input.project_id,
            &title,
            &description_markdown,
            input.parent_id,
            input.position,
        )
        .map_err(command_error)?;
    let pending = pending_request.map(|request| PendingTaskTitleGeneration {
        todo_id: todo.id,
        expected_title: title,
        request,
    });
    let snapshot = db
        .app_snapshot(Some(todo.project_id), Some(todo.id))
        .map_err(command_error)?;

    Ok((snapshot, pending))
}

pub(super) fn generate_task_title(
    settings: &AppSettingsSummary,
    request: &TaskTitleGenerationRequest,
) -> Result<String, String> {
    match normalized_task_titler(&settings.task_titler)?.as_str() {
        "codex-spark" => run_task_title_generation_process(settings, request).or_else(|err| {
            eprintln!("warning: codex-spark task title generation failed: {err}");
            Ok(local_fallback_task_title(&request.description_markdown))
        }),
        "local-fallback" => Ok(local_fallback_task_title(&request.description_markdown)),
        other => Err(format!("unknown task titler: {other}")),
    }
}

pub(super) fn manual_title_generation_request(
    db: &AppDb,
    todo_id: i64,
) -> Result<PendingTaskTitleGeneration, String> {
    let todo = db
        .get_todos(&[todo_id])
        .map_err(command_error)?
        .into_iter()
        .next()
        .ok_or_else(|| format!("todo {todo_id} not found"))?;
    let project = db.get_project(todo.project_id).map_err(command_error)?;

    Ok(PendingTaskTitleGeneration {
        todo_id: todo.id,
        expected_title: todo.title,
        request: TaskTitleGenerationRequest {
            working_directory: expand_home_alias(&project.working_directory)
                .display()
                .to_string(),
            description_markdown: todo.description_markdown,
        },
    })
}

pub(super) fn spawn_background_task_title_generation(
    app: AppHandle,
    pending: PendingTaskTitleGeneration,
) {
    thread::spawn(move || {
        let _ = emit_todo_changed(&app, pending.todo_id, "title_generation_started");
        apply_generated_task_title(&app, &pending);
        let _ = emit_todo_changed(&app, pending.todo_id, "title_generation_finished");
    });
}

fn apply_generated_task_title(app: &AppHandle, pending: &PendingTaskTitleGeneration) {
    let db = app.state::<AppDb>();
    let Ok(settings) = db.app_settings() else {
        return;
    };
    let Ok(generated_title) = generate_task_title(&settings, &pending.request) else {
        return;
    };
    if generated_title == pending.expected_title {
        return;
    }

    let Ok(true) = db.update_todo_title_if_current(
        pending.todo_id,
        &pending.expected_title,
        &generated_title,
        crate::core::Actor::system("Boomerang"),
    ) else {
        return;
    };
    let _ = emit_todo_changed(app, pending.todo_id, "title_changed");
}

fn build_task_title_generation_process_command(
    settings: &AppSettingsSummary,
    request: &TaskTitleGenerationRequest,
) -> Result<ProcessCommandSpec, String> {
    let cwd = required_command_text("working directory", &request.working_directory)?;
    let program = required_command_text("Codex path", &settings.codex_path)?;
    let prompt = task_title_generation_prompt(&request.description_markdown);
    let args = vec![
        "exec".to_string(),
        "--model".to_string(),
        CODEX_SPARK_MODEL.to_string(),
        "--sandbox".to_string(),
        "read-only".to_string(),
        "--cd".to_string(),
        cwd.clone(),
        "--skip-git-repo-check".to_string(),
        "--ephemeral".to_string(),
        "--color".to_string(),
        "never".to_string(),
        prompt,
    ];

    Ok(ProcessCommandSpec {
        display: shell_join(&program, &args),
        program,
        args,
        cwd,
    })
}

fn normalized_task_titler(value: &str) -> Result<String, String> {
    match value.trim().to_lowercase().as_str() {
        "codex-spark" => Ok("codex-spark".to_string()),
        "local-fallback" => Ok("local-fallback".to_string()),
        other => Err(format!("unknown task titler: {other}")),
    }
}

fn pending_title_generation_request(
    db: &AppDb,
    project_id: i64,
    description_markdown: &str,
) -> Result<Option<TaskTitleGenerationRequest>, String> {
    let settings = db.app_settings().map_err(command_error)?;
    if normalized_task_titler(&settings.task_titler)? != "codex-spark" {
        return Ok(None);
    }

    let project = db.get_project(project_id).map_err(command_error)?;
    Ok(Some(TaskTitleGenerationRequest {
        working_directory: expand_home_alias(&project.working_directory)
            .display()
            .to_string(),
        description_markdown: description_markdown.to_string(),
    }))
}

fn run_task_title_generation_process(
    settings: &AppSettingsSummary,
    request: &TaskTitleGenerationRequest,
) -> Result<String, String> {
    let process = build_task_title_generation_process_command(settings, request)?;
    let output = run_process_with_timeout(&process, TASK_TITLE_GENERATION_TIMEOUT)?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() {
            return Err(format!(
                "task title generation exited with {}",
                output.status
            ));
        }
        return Err(format!("task title generation failed: {stderr}"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    clean_generated_task_title(&stdout)
        .ok_or_else(|| "task title generation returned an empty title".to_string())
}

fn run_process_with_timeout(
    process: &ProcessCommandSpec,
    timeout: Duration,
) -> Result<Output, String> {
    // GUI-launched apps inherit launchd's minimal PATH, which misses Homebrew
    // and user bin directories where a bare `codex` usually lives.
    let path = crate::pty::usable_cli_path(std::env::var("PATH").ok().as_deref());
    let mut child = Command::new(&process.program)
        .args(&process.args)
        .current_dir(&process.cwd)
        .env("PATH", path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("failed to start task title generator: {err}"))?;
    let started_at = Instant::now();

    loop {
        if child
            .try_wait()
            .map_err(|err| format!("failed to read task title generator status: {err}"))?
            .is_some()
        {
            return child
                .wait_with_output()
                .map_err(|err| format!("failed to read task title generator output: {err}"));
        }

        if started_at.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Err("task title generation timed out".to_string());
        }

        thread::sleep(Duration::from_millis(100));
    }
}

fn task_title_generation_prompt(description_markdown: &str) -> String {
    let description = description_markdown.trim();
    let description = if description.is_empty() {
        "(No task description was provided.)"
    } else {
        description
    };

    format!(
        "Generate a concise title for a task in a local task manager.\n\
         This is a TaskCooker task title, not a generic summary.\n\
         Requirements:\n\
         - Return only the task title.\n\
         - Use 3 to 8 words.\n\
         - Do not wrap the title in quotes.\n\
         - Do not include Markdown, bullets, IDs, or a trailing period.\n\n\
         If image references are present, inspect or use their content when it helps determine the task title.\n\n\
         Task description:\n{description}"
    )
}

fn local_fallback_task_title(description_markdown: &str) -> String {
    description_markdown
        .lines()
        .filter_map(clean_local_fallback_task_title)
        .next()
        .unwrap_or_else(|| "Untitled".to_string())
}

fn clean_local_fallback_task_title(value: &str) -> Option<String> {
    let title = clean_generated_task_title(value)?;
    if is_image_only_line(&title) {
        None
    } else {
        Some(title)
    }
}

fn is_image_only_line(value: &str) -> bool {
    let value = value.trim();
    (value.starts_with("![") && value.contains("](") && value.ends_with(')'))
        || (value.starts_with("<img ") && value.ends_with('>'))
}

fn clean_generated_task_title(value: &str) -> Option<String> {
    let mut title = value
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())?
        .trim_start_matches('#')
        .trim_start_matches(['-', '*'])
        .trim()
        .trim_start_matches("[ ]")
        .trim_start_matches("[x]")
        .trim_start_matches("[X]")
        .trim()
        .trim_matches(['"', '\'', '`'])
        .trim()
        .chars()
        .filter(|character| !character.is_ascii_control())
        .collect::<String>();

    if title.len() > 80 {
        title = title.chars().take(77).collect::<String>();
        title = format!("{}...", title.trim_end());
    }

    if title.is_empty() {
        None
    } else {
        Some(title)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::core::NewProject;

    #[test]
    fn builds_codex_spark_title_generation_command_from_settings() {
        let settings = app_settings_fixture();
        let request = TaskTitleGenerationRequest {
            working_directory: "/tmp/boomerang-project".to_string(),
            description_markdown: "Investigate why deploy previews fail.".to_string(),
        };

        let process = build_task_title_generation_process_command(&settings, &request).unwrap();

        assert_eq!(process.program, "/opt/homebrew/bin/codex");
        assert_eq!(
            process.args[..11],
            [
                "exec",
                "--model",
                "gpt-5.3-codex-spark",
                "--sandbox",
                "read-only",
                "--cd",
                "/tmp/boomerang-project",
                "--skip-git-repo-check",
                "--ephemeral",
                "--color",
                "never",
            ]
        );
        let prompt = process.args.last().unwrap();
        assert!(prompt.contains("Return only the task title"));
        assert!(prompt.contains("This is a TaskCooker task title"));
        assert!(prompt.contains("If image references are present"));
        assert!(prompt.contains("Investigate why deploy previews fail."));
    }

    #[test]
    fn blank_title_create_returns_fallback_and_pending_codex_generation() {
        let db = AppDb::open_in_memory().unwrap();
        let project = db
            .create_project(NewProject {
                name: "Boomerang".to_string(),
                working_directory: "/tmp/boomerang".to_string(),
                display_id_prefix: "B".to_string(),
                actions_directory: "actions".to_string(),
                terminal_wsl_enabled: false,
                parent_project_id: None,
                inherit_parent: false,
            })
            .unwrap();

        let (snapshot, pending) = create_todo_in_db_with_pending_title_generation(
            &db,
            CreateTodoCommand {
                project_id: project.id,
                title: "   ".to_string(),
                description_markdown: Some(
                    "![](<~/Library/Application Support/shot.png>)\n\nAdd in resume support."
                        .to_string(),
                ),
                parent_id: None,
                position: None,
            },
        )
        .unwrap();

        let created = snapshot
            .todos
            .iter()
            .find(|todo| todo.id == snapshot.selected_todo_id)
            .unwrap();
        let pending = pending.unwrap();

        assert_eq!(created.title, "Add in resume support.");
        assert_eq!(pending.todo_id, created.id);
        assert_eq!(pending.expected_title, "Add in resume support.");
        assert_eq!(
            pending.request.description_markdown,
            "![](<~/Library/Application Support/shot.png>)\n\nAdd in resume support."
        );
    }

    #[test]
    fn manual_request_uses_current_todo_title_and_description() {
        let db = AppDb::open_in_memory().unwrap();
        let project = db
            .create_project(NewProject {
                name: "Boomerang".to_string(),
                working_directory: "/tmp/boomerang".to_string(),
                display_id_prefix: "B".to_string(),
                actions_directory: "actions".to_string(),
                terminal_wsl_enabled: false,
                parent_project_id: None,
                inherit_parent: false,
            })
            .unwrap();
        let (snapshot, _) = create_todo_in_db_with_pending_title_generation(
            &db,
            CreateTodoCommand {
                project_id: project.id,
                title: "Fix flaky login test".to_string(),
                description_markdown: Some("The login test fails on CI retries.".to_string()),
                parent_id: None,
                position: None,
            },
        )
        .unwrap();
        let todo_id = snapshot.selected_todo_id;

        let pending = manual_title_generation_request(&db, todo_id).unwrap();

        assert_eq!(pending.todo_id, todo_id);
        assert_eq!(pending.expected_title, "Fix flaky login test");
        assert_eq!(
            pending.request.description_markdown,
            "The login test fails on CI retries."
        );
        assert_eq!(pending.request.working_directory, "/tmp/boomerang");
    }

    #[test]
    fn local_fallback_task_title_skips_image_only_lines() {
        assert_eq!(
            local_fallback_task_title(
                "![](<~/Library/Application Support/shot.png>)\n\nAdd in resume support."
            ),
            "Add in resume support."
        );
    }

    #[test]
    fn local_fallback_task_title_uses_untitled_when_every_line_is_an_image() {
        assert_eq!(
            local_fallback_task_title(
                "![screenshot](~/Library/Application Support/one.png)\n\
                 <img src=\"~/Library/Application Support/two.png\" width=\"420\">"
            ),
            "Untitled"
        );
    }

    fn app_settings_fixture() -> AppSettingsSummary {
        AppSettingsSummary {
            app_context_markdown: "".to_string(),
            folder_open_app: "code".to_string(),
            mcp_enabled: true,
            mcp_port: 8787,
            mcp_token: "token".to_string(),
            theme: "system".to_string(),
            claude_path: "claude".to_string(),
            codex_path: "/opt/homebrew/bin/codex".to_string(),
            deep_link_fallback: true,
            home_project_id: 0,
            task_titler: "codex-spark".to_string(),
            task_details_rail_hidden: false,
            task_list_collapsed_project_ids: Vec::new(),
            task_list_collapsed_subproject_ids: Vec::new(),
            task_list_collapsed_todo_ids: Vec::new(),
            task_list_width: 300,
            task_detail_description_width: 420,
            markdown_editor_mode: "rich".to_string(),
            markdown_editor_font_family: "sans-serif".to_string(),
            markdown_editor_font_size: "12px".to_string(),
            markdown_editor_max_image_height: "none".to_string(),
            markdown_toc_hidden: false,
            markdown_description_toc_width: 180,
            markdown_artifact_toc_width: 180,
            project_accent_border_width: 4,
            slowdown_profiler_enabled: true,
            terminal_tmux_enabled: false,
            external_terminal_openers: "open -na Ghostty.app --args --command={tmuxCommand}"
                .to_string(),
        }
    }
}
