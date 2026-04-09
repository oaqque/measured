from __future__ import annotations

from pathlib import Path


def main() -> None:
    project_file = Path(__file__).resolve().parent.parent / "AppleHealthBridge.xcodeproj" / "project.pbxproj"
    content = project_file.read_text(encoding="utf-8")

    if "com.apple.HealthKit" in content:
        return

    marker = "TargetAttributes = {\n"
    target_attributes_start = content.find(marker)
    if target_attributes_start == -1:
        raise RuntimeError("Unable to find TargetAttributes section in project.pbxproj")

    development_team_marker = 'DevelopmentTeam = "";'
    development_team_index = content.find(development_team_marker, target_attributes_start)
    if development_team_index == -1:
        raise RuntimeError("Unable to find DevelopmentTeam entry in TargetAttributes section")

    insert_at = development_team_index + len(development_team_marker)
    insertion = """
						SystemCapabilities = {
							com.apple.HealthKit = {
								enabled = 1;
							};
						};"""
    updated = content[:insert_at] + insertion + content[insert_at:]
    project_file.write_text(updated, encoding="utf-8")


if __name__ == "__main__":
    main()
