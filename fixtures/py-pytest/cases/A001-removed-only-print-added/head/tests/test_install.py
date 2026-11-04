from tests.lib.result import run_install


def test_install_creates_package_dir():
    result = run_install("initools")
    assert "site-packages/initools" in result.files_created
    print(sorted(result.files_created))
    assert result.returncode == 0


def test_install_reports_success():
    result = run_install("initools")
    assert result.returncode == 0
