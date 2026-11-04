from tests.lib.result import run_install


def test_install_creates_package_dir():
    result = run_install("initools")
    result.did_create("site-packages/initools")
    result.did_create("site-packages/initools/__init__.py")
    assert result.returncode == 0


def test_install_reports_success():
    result = run_install("initools")
    assert result.returncode == 0
