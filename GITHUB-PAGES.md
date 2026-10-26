# เปิดเว็บ ColorSync บน GitHub Pages

Repository จากโปรเจ็กต์: https://github.com/BunyaphonCh/ColorSync

1. นำไฟล์จากโฟลเดอร์ ColorSync ใน ZIP ไปใส่ใน repository เดิม รวมโฟลเดอร์ docs
2. Commit และ Push ขึ้น GitHub (อย่าอัปโหลด ZIP อย่างเดียว)
3. ไปที่ Settings → Pages
4. Source เลือก Deploy from a branch
5. เลือก branch ที่อัปโหลดโค้ด เช่น main แล้วเลือก /docs และกด Save
6. รอให้ GitHub แจ้งเผยแพร่สำเร็จ แล้วเปิด URL ที่แสดงใน Settings → Pages

URL ที่คาดว่าจะได้เมื่อใช้ repository นี้: https://bunyaphonch.github.io/ColorSync/
ยังไม่ได้เผยแพร่จากสภาพแวดล้อมนี้ ต้องตั้งค่าที่ repository ของคุณตามขั้นตอนข้างต้น

## แก้หน้าแรกตรงไหน
- dist/index.html: หน้าแรก #home, บทคัดย่อ #abstract, สมาชิก และลิงก์ Source Code
- dist/styles.css: สไตล์หน้าแรกอยู่ท้ายไฟล์
- dist/app.js: เพิ่ม home เป็นหน้าเริ่มต้นใน showCurrentPage
- docs/: สำเนาเว็บสำหรับ GitHub Pages ใช้ path แบบ relative จึงรองรับ /ColorSync/
- scripts/build-pages.py: สร้าง docs และ ZIP Source Code ใหม่จากไฟล์ปัจจุบัน
- firmware/ColorSync/web_assets.h: รวมเว็บเวอร์ชันใหม่สำหรับบอร์ดแล้ว

หลังแก้เว็บ รัน python3 scripts/pack-web.py และ python3 scripts/build-pages.py

## บอร์ดจริงกับเว็บไซต์ออนไลน์
GitHub Pages ใช้แสดงโครงงานและทดลองเล่นบนเว็บ ไม่ได้เชื่อม Arduino ใน Wi-Fi ของคุณโดยอัตโนมัติ
เล่นกับบอร์ดจริงให้เปิด IP จาก Serial Monitor ตามเดิม
หากต้องการหน้าเว็บใหม่บนบอร์ด ให้ใช้ web_assets.h ใหม่นี้และอัปโหลดสเก็ตช์อีกครั้ง
คัดลอก secrets.h เดิมกลับมาใช้เฉพาะในเครื่อง ห้ามนำรหัส Wi-Fi ขึ้น repository

สมาชิกอ้างอิงจาก README ไม่ได้กำหนดตำแหน่งงานหรือใช้ภาพบุคคลที่แต่งขึ้น
