use std::process::Command;

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::core::{expand_home_alias, AppDb, AppError};

use super::{
    command_error, emit_project_changed, ConnectProjectGitHubRepositoryCommand,
    ProjectGitRepositoryCommand,
};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGitRepositorySummary {
    pub full_name: String,
    pub html_url: String,
    pub remote_url: String,
}

#[tauri::command]
pub fn get_project_git_repository(
    state: State<'_, AppDb>,
    input: ProjectGitRepositoryCommand,
) -> Result<Option<ProjectGitRepositorySummary>, String> {
    project_git_repository(&state, input.project_id).map_err(command_error)
}

#[tauri::command]
pub fn list_project_github_owners() -> Result<Vec<String>, String> {
    github_owner_options().map_err(command_error)
}

#[tauri::command]
pub fn push_project_git_repository(
    app: AppHandle,
    state: State<'_, AppDb>,
    input: ProjectGitRepositoryCommand,
) -> Result<ProjectGitRepositorySummary, String> {
    let summary = project_git_repository(&state, input.project_id)
        .map_err(command_error)?
        .ok_or_else(|| {
            command_error(AppError::InvalidInput(
                "GitHub origin remote not found".to_string(),
            ))
        })?;
    let project = state.get_project(input.project_id).map_err(command_error)?;
    let project_dir = expand_home_alias(&project.working_directory);
    ensure_project_has_commits(&project_dir).map_err(command_error)?;

    let output = Command::new("git")
        .arg("-C")
        .arg(&project_dir)
        .args(push_project_args())
        .output()
        .map_err(AppError::from)
        .map_err(command_error)?;
    ensure_success("git push", output).map_err(command_error)?;
    emit_project_changed(&app, input.project_id, "git_repository_pushed")?;
    Ok(summary)
}

#[tauri::command]
pub fn connect_project_github_repository(
    app: AppHandle,
    state: State<'_, AppDb>,
    input: ConnectProjectGitHubRepositoryCommand,
) -> Result<ProjectGitRepositorySummary, String> {
    let owner = required_github_segment("owner", &input.owner).map_err(command_error)?;
    let repo_name = required_repo_name(&input.repo_name).map_err(command_error)?;
    let visibility = match input.visibility.as_str() {
        "public" => "--public",
        "private" => "--private",
        _ => {
            return Err(command_error(AppError::InvalidInput(
                "visibility must be public or private".to_string(),
            )))
        }
    };
    let project = state.get_project(input.project_id).map_err(command_error)?;
    let project_dir = expand_home_alias(&project.working_directory);
    if !project_dir.is_dir() {
        return Err(command_error(AppError::InvalidInput(format!(
            "project working directory does not exist: {}",
            project.working_directory
        ))));
    }

    if !project_dir.join(".git").exists() {
        let output = Command::new("git")
            .arg("-C")
            .arg(&project_dir)
            .arg("init")
            .output()
            .map_err(AppError::from)
            .map_err(command_error)?;
        ensure_success("git init", output).map_err(command_error)?;
    }

    let full_name = format!("{owner}/{repo_name}");
    let output = Command::new("gh")
        .arg("repo")
        .arg("create")
        .arg(&full_name)
        .arg(visibility)
        .arg("--source")
        .arg(&project_dir)
        .arg("--remote")
        .arg("origin")
        .output()
        .map_err(AppError::from)
        .map_err(command_error)?;
    ensure_success("gh repo create", output).map_err(command_error)?;

    let summary = project_git_repository(&state, input.project_id)
        .map_err(command_error)?
        .unwrap_or(ProjectGitRepositorySummary {
            full_name,
            html_url: format!("https://github.com/{owner}/{repo_name}"),
            remote_url: format!("https://github.com/{owner}/{repo_name}.git"),
        });
    emit_project_changed(&app, input.project_id, "git_repository_connected")?;
    Ok(summary)
}

fn push_project_args() -> [&'static str; 4] {
    ["push", "-u", "origin", "HEAD"]
}

fn ensure_project_has_commits(project_dir: &std::path::Path) -> Result<(), AppError> {
    let output = Command::new("git")
        .arg("-C")
        .arg(project_dir)
        .arg("rev-list")
        .arg("-n")
        .arg("1")
        .arg("--all")
        .output()?;
    if output.status.success() && !String::from_utf8_lossy(&output.stdout).trim().is_empty() {
        return Ok(());
    }
    Err(AppError::InvalidInput(
        "project has no commits to push".to_string(),
    ))
}

fn project_git_repository(
    db: &AppDb,
    project_id: i64,
) -> Result<Option<ProjectGitRepositorySummary>, AppError> {
    let project = db.get_project(project_id)?;
    let project_dir = expand_home_alias(&project.working_directory);
    if !project_dir.is_dir() || !project_dir.join(".git").exists() {
        return Ok(None);
    }

    let output = Command::new("git")
        .arg("-C")
        .arg(&project_dir)
        .arg("remote")
        .arg("get-url")
        .arg("origin")
        .output()?;
    if !output.status.success() {
        return Ok(None);
    }

    let remote_url = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if remote_url.is_empty() {
        return Ok(None);
    }

    Ok(github_remote_summary(&remote_url))
}

fn github_remote_summary(remote_url: &str) -> Option<ProjectGitRepositorySummary> {
    let full_name = github_full_name(remote_url)?;
    Some(ProjectGitRepositorySummary {
        html_url: format!("https://github.com/{full_name}"),
        full_name,
        remote_url: remote_url.to_string(),
    })
}

fn github_full_name(remote_url: &str) -> Option<String> {
    let trimmed = remote_url.trim().trim_end_matches('/');
    let path = trimmed
        .strip_prefix("git@github.com:")
        .or_else(|| trimmed.strip_prefix("https://github.com/"))
        .or_else(|| trimmed.strip_prefix("http://github.com/"))?;
    let full_name = path.strip_suffix(".git").unwrap_or(path);
    let mut parts = full_name.split('/');
    let owner = parts.next()?;
    let repo = parts.next()?;
    if owner.is_empty() || repo.is_empty() || parts.next().is_some() {
        return None;
    }
    Some(format!("{owner}/{repo}"))
}

fn required_github_segment(label: &str, value: &str) -> Result<String, AppError> {
    let value = value.trim();
    if value.is_empty() {
        return Err(AppError::InvalidInput(format!("{label} is required")));
    }
    if value.contains('/') || value.contains(' ') {
        return Err(AppError::InvalidInput(format!(
            "{label} must not contain spaces or slashes"
        )));
    }
    Ok(value.to_string())
}

fn required_repo_name(value: &str) -> Result<String, AppError> {
    let value = required_github_segment("repo name", value)?;
    let normalized = repo_name_slug(&value);
    if value != normalized {
        return Err(AppError::InvalidInput(
            "repo name must use lowercase letters, numbers, and dashes".to_string(),
        ));
    }
    Ok(value)
}

fn repo_name_slug(value: &str) -> String {
    let raw = value
        .trim()
        .to_lowercase()
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect::<String>();
    raw.split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

fn ensure_success(label: &str, output: std::process::Output) -> Result<(), AppError> {
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let detail = if stderr.is_empty() { stdout } else { stderr };
    Err(AppError::InvalidInput(format!("{label} failed: {detail}")))
}

fn github_owner_options() -> Result<Vec<String>, AppError> {
    let account = gh_lines(&["api", "user", "--jq", ".login"])?
        .into_iter()
        .next()
        .unwrap_or_default();
    let mut orgs = gh_lines(&["api", "user/orgs", "--jq", ".[].login"])?;
    orgs.sort();
    Ok(owner_options_with_account_first(&account, orgs))
}

fn owner_options_with_account_first(account: &str, orgs: Vec<String>) -> Vec<String> {
    let mut owners = Vec::new();
    let account = account.trim();
    if !account.is_empty() {
        owners.push(account.to_string());
    }

    for org in orgs {
        let org = org.trim();
        if !org.is_empty() && !owners.iter().any(|owner| owner == org) {
            owners.push(org.to_string());
        }
    }

    owners
}

fn gh_lines(args: &[&str]) -> Result<Vec<String>, AppError> {
    let output = Command::new("gh")
        .args(args)
        .output()
        .map_err(AppError::from)?;
    if !output.status.success() {
        return Ok(Vec::new());
    }
    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect())
}

#[cfg(test)]
mod tests {
    use super::{
        github_remote_summary, owner_options_with_account_first, push_project_args, repo_name_slug,
        required_repo_name,
    };

    #[test]
    fn parses_github_ssh_remote() {
        let summary = github_remote_summary("git@github.com:markcl/boomerangtasks.git").unwrap();

        assert_eq!(summary.full_name, "markcl/boomerangtasks");
        assert_eq!(summary.html_url, "https://github.com/markcl/boomerangtasks");
    }

    #[test]
    fn ignores_non_github_remote() {
        assert_eq!(
            github_remote_summary("git@example.com:markcl/boomerangtasks.git"),
            None
        );
    }

    #[test]
    fn keeps_account_owner_before_orgs() {
        assert_eq!(
            owner_options_with_account_first(
                "xmarkclx",
                vec![
                    "NoSleepTinker".to_string(),
                    "xmarkclx".to_string(),
                    "taskcooker-org".to_string()
                ]
            ),
            vec!["xmarkclx", "NoSleepTinker", "taskcooker-org"]
        );
    }

    #[test]
    fn repo_name_must_be_lowercase_dash_slug() {
        assert_eq!(
            repo_name_slug("Boomerang Tasks Test"),
            "boomerang-tasks-test"
        );
        assert!(required_repo_name("boomerang-tasks-test").is_ok());
        assert!(required_repo_name("Boomerang Tasks Test").is_err());
    }

    #[test]
    fn push_args_set_upstream_for_first_push() {
        assert_eq!(push_project_args(), ["push", "-u", "origin", "HEAD"]);
    }
}
