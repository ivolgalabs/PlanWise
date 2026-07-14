import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:uuid/uuid.dart';

/// Получить стабильный device UUID. При первом вызове генерируется и
/// сохраняется в flutter_secure_storage. Используется как CRDT actor_id.
///
/// В тестах — инжектируем фиктивный id напрямую через репозиторий.
Future<String> getDeviceId({FlutterSecureStorage? storage}) async {
  final s = storage ?? const FlutterSecureStorage();
  final existing = await s.read(key: _key);
  if (existing != null) return existing;
  final id = const Uuid().v4();
  await s.write(key: _key, value: id);
  return id;
}

const _key = 'device_id';
