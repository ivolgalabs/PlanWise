import 'package:daily_planner/ui/theme/app_colors.dart';
import 'package:flutter/material.dart';

/// Bottom-sheet для создания/редактирования задачи.
/// Возвращает ({title, colorSetId}) или null при отмене.
class TaskEditorSheet extends StatefulWidget {
  const TaskEditorSheet({
    this.initialTitle = '',
    this.initialColorSetId,
    super.key,
  });

  final String initialTitle;
  final String? initialColorSetId;

  @override
  State<TaskEditorSheet> createState() => _TaskEditorSheetState();
}

class _TaskEditorSheetState extends State<TaskEditorSheet> {
  late final TextEditingController _title;
  String? _colorSetId;

  static const _sets = <(String, String, Color)>[
    ('cs-none', 'Без категории', AppColors.setNone),
    ('cs-work', 'Работа', AppColors.setWork),
    ('cs-personal', 'Личное', AppColors.setPersonal),
    ('cs-sport', 'Спорт', AppColors.setSport),
  ];

  @override
  void initState() {
    super.initState();
    _title = TextEditingController(text: widget.initialTitle);
    _colorSetId = widget.initialColorSetId;
  }

  @override
  void dispose() {
    _title.dispose();
    super.dispose();
  }

  void _save() {
    final title = _title.text.trim();
    if (title.isEmpty) return;
    Navigator.of(context).pop((title: title, colorSetId: _colorSetId));
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(
        16,
        16,
        16,
        16 + MediaQuery.of(context).viewInsets.bottom,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextField(
            controller: _title,
            autofocus: true,
            textCapitalization: TextCapitalization.sentences,
            decoration: const InputDecoration(
              labelText: 'Новая задача',
              border: OutlineInputBorder(),
            ),
            onSubmitted: (_) => _save(),
          ),
          const SizedBox(height: 16),
          Wrap(
            spacing: 8,
            children: [
              for (final (id, label, color) in _sets)
                ChoiceChip(
                  label: Text(label),
                  avatar: CircleAvatar(backgroundColor: color, radius: 6),
                  selected: _colorSetId == id,
                  onSelected: (_) => setState(() => _colorSetId = id),
                ),
            ],
          ),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: _save,
            child: const Text('Сохранить'),
          ),
        ],
      ),
    );
  }
}
