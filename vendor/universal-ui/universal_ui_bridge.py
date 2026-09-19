"""Universal UI Python Bridge.

Dynamically loads design tokens and 24 symmetrical core themes from
/Users/ivolga/My Project/Universal UI/themes.css, tokens.css and typography.css,
and generates native Qt / PySide6 QSS stylesheets. Any edit in Universal UI CSS
files is automatically reflected in all consuming Python applications.

Токены, которых нет в themes.css (радиусы, отступы, шрифты, высоты контролов),
берутся из tokens.css/typography.css — значения в QSS больше не захардкожены.
"""
import re
from pathlib import Path

UNIVERSAL_UI_DIR = Path(__file__).parent.resolve()
THEMES_CSS_PATH = UNIVERSAL_UI_DIR / "themes.css"
TOKENS_CSS_PATH = UNIVERSAL_UI_DIR / "tokens.css"
TYPOGRAPHY_CSS_PATH = UNIVERSAL_UI_DIR / "typography.css"


def parse_css_variables(file_path):
    """Parses a CSS file and extracts theme rules into a dict mapping theme_name -> {var_name: var_value}."""
    if not file_path.exists():
        return {}

    content = file_path.read_text(encoding="utf-8")

    # Match blocks like :root { ... } or [data-theme="foo"] { ... }
    blocks = re.findall(r'(:root|\[data-theme=["\']?([\w-]+)["\']?\])\s*\{([^}]+)\}', content)

    themes = {}
    for full_match, theme_name, body in blocks:
        name = theme_name if theme_name else "default"
        var_dict = {}
        # Построчный разбор: файлы бывают двух форматов —
        #   themes.css:  несколько пар на строке (--a: 1; --b: 2;)
        #   tokens.css: одна пара + комментарий ПОСЛЕ ";" (--a: 1; /* комм */)
        # Наивный split(";") склеивал "--b" с комментарием и терял ключи,
        # поэтому режем строку на ";" и каждый кусок парсим отдельно.
        for line in body.split("\n"):
            for chunk in line.split(";"):
                chunk = chunk.strip()
                m = re.match(r'^(--[\w-]+):\s*(.+)$', chunk)
                if m:
                    v = re.sub(r'/\*.*?\*/', '', m.group(2)).strip()
                    if v:
                        var_dict[m.group(1)] = v
        if var_dict:
            themes[name] = var_dict

    return themes


def get_theme_variables(theme_name="dark-slate"):
    """Returns merged dictionary of CSS variables for the requested theme."""
    themes = parse_css_variables(THEMES_CSS_PATH)
    default_vars = themes.get("default", {})
    selected_vars = themes.get(theme_name, {})

    # Merge default + selected
    merged = dict(default_vars)
    merged.update(selected_vars)
    return merged


def _px(value, fallback):
    """Converts a token value to px: '8px' -> 8, '0.85rem' -> round(0.85*16)."""
    value = str(value or "").strip().lower()
    if value.endswith("px"):
        try:
            return int(float(value[:-2]))
        except ValueError:
            return fallback
    if value.endswith("rem"):
        try:
            return int(round(float(value[:-3]) * 16))
        except ValueError:
            return fallback
    try:
        return int(float(value))
    except ValueError:
        return fallback


def generate_qss(theme_name="dark-slate"):
    """Generates a complete PySide6 QSS stylesheet dynamically resolved from Universal UI CSS tokens."""
    v = get_theme_variables(theme_name)

    bg_primary = v.get("--bg-primary", "#17181c")
    bg_secondary = v.get("--bg-secondary", "#1f2126")
    bg_tertiary = v.get("--bg-tertiary", "#262930")
    bg_hover = v.get("--bg-hover", "#31353e")

    accent = v.get("--accent", "#89b4fa")
    text_primary = v.get("--text-primary", "#f2f3f5")
    text_secondary = v.get("--text-secondary", "#949ba4")
    text_muted = v.get("--text-muted", "#6a6f77")
    border_color = v.get("--border-color", "#26282e")

    # Токены из tokens.css / typography.css (единый источник вместо хардкода)
    tokens = parse_css_variables(TOKENS_CSS_PATH).get("default", {})
    typo = parse_css_variables(TYPOGRAPHY_CSS_PATH).get("default", {})

    radius_md = _px(tokens.get("--radius-md"), 6)      # list items, chips
    radius_lg = _px(tokens.get("--radius-lg"), 8)      # buttons, inputs, cards
    radius_xl = _px(tokens.get("--radius-xl"), 12)     # modal corners
    sp_3 = _px(tokens.get("--sp-3"), 6)                # compact paddings
    sp_4 = _px(tokens.get("--sp-4"), 8)                # default paddings
    sp_5 = _px(tokens.get("--sp-5"), 10)               # row paddings
    control_h = _px(tokens.get("--control-h"), 38)     # 38px-грид
    fs_base = _px(typo.get("--fs-base"), 13)           # body text

    qss = f"""
    QWidget {{
        background-color: {bg_primary};
        color: {text_primary};
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        font-size: {fs_base}px;
    }}
    
    QMainWindow, QDialog {{
        background-color: {bg_primary};
    }}
    
    QFrame, .QGroupBox {{
        background-color: {bg_secondary};
        border: 1px solid {border_color};
        border-radius: {radius_lg}px;
    }}
    
    QLabel {{
        color: {text_primary};
        background-color: transparent;
    }}
    
    QLabel[class="secondary"] {{
        color: {text_secondary};
    }}
    
    QLabel[class="muted"] {{
        color: {text_muted};
    }}
    
    QPushButton {{
        background-color: {bg_tertiary};
        color: {text_primary};
        border: 1px solid {border_color};
        border-radius: {radius_lg}px;
        padding: {sp_3}px {sp_5}px;
        min-height: {control_h - 2 * sp_3}px;
        font-weight: 500;
    }}
    
    QPushButton:hover {{
        background-color: {bg_hover};
        border-color: {accent};
    }}
    
    QPushButton:pressed {{
        background-color: {accent};
        color: #ffffff;
    }}
    
    QPushButton[class="primary"] {{
        background-color: {accent};
        color: #ffffff;
        border: none;
    }}
    
    QPushButton[class="primary"]:hover {{
        background-color: {accent};
        opacity: 0.9;
    }}
    
    QLineEdit, QTextEdit, QPlainTextEdit {{
        background-color: {bg_secondary};
        color: {text_primary};
        border: 1px solid {border_color};
        border-radius: {radius_lg}px;
        padding: {sp_3}px {sp_4}px;
        selection-background-color: {accent};
    }}
    
    QLineEdit:focus, QTextEdit:focus {{
        border-color: {accent};
    }}
    
    QListWidget, QTreeWidget, QTableWidget {{
        background-color: {bg_secondary};
        border: 1px solid {border_color};
        border-radius: {radius_lg}px;
        outline: none;
    }}
    
    QListWidget::item, QTreeWidget::item {{
        padding: {sp_3}px {sp_4}px;
        border-radius: {radius_md}px;
    }}
    
    QListWidget::item:hover, QTreeWidget::item:hover {{
        background-color: {bg_hover};
    }}
    
    QListWidget::item:selected, QTreeWidget::item:selected {{
        background-color: {accent};
        color: #ffffff;
    }}
    
    QProgressBar {{
        background-color: {bg_tertiary};
        border: 1px solid {border_color};
        border-radius: {radius_md}px;
        text-align: center;
        color: {text_primary};
    }}
    
    QProgressBar::chunk {{
        background-color: {accent};
        border-radius: {radius_md}px;
    }}
    
    QComboBox {{
        background-color: {bg_secondary};
        color: {text_primary};
        border: 1px solid {border_color};
        border-radius: {radius_lg}px;
        padding: {sp_3}px {sp_4}px;
        min-height: {control_h - 2 * sp_3}px;
    }}
    
    QComboBox::drop-down {{
        border: none;
    }}
    
    QScrollBar:vertical {{
        background-color: {bg_primary};
        width: 8px;
        margin: 0px;
    }}
    
    QScrollBar::handle:vertical {{
        background-color: {border_color};
        min-height: 20px;
        border-radius: {radius_md}px;
    }}
    
    QScrollBar::handle:vertical:hover {{
        background-color: {text_muted};
    }}
    
    QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {{
        height: 0px;
    }}
    """
    return qss


def apply_universal_ui(app_or_widget, theme_name="dark-slate"):
    """Applies the Universal UI theme directly to a PySide6 QApplication or QWidget."""
    qss = generate_qss(theme_name)
    app_or_widget.setStyleSheet(qss)
