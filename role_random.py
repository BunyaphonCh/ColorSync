import random

names = ["อิว", "ตาล", "ปิ่น", "เบล"]

duties = [
    "ฮาร์ดแวร์และวงจร (25%)",
    "ระบบเกม (25%)",
    "การเชื่อมต่อบอร์ดกับเว็บไซต์ (25%)",
    "เว็บไซต์และประวัติคะแนน (25%)"
]

random.shuffle(names)

print("ผลสุ่มแบ่งหน้าที่ 😈\n")

for i, duty in enumerate(duties):
    print(f"คนที่ {i + 1}: {names[i]}")
    print(f"หน้าที่: {duty}\n")