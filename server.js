

const express = require("express");
const app = express();
const db = require("./db");
const session = require('express-session');
require('dotenv').config();
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);
const bcrypt = require('bcrypt');
const PORT = process.env.PORT || 3000;




app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: 'secret-key',
    resave: false,
    saveUninitialized: false
  })
);
app.set("view engine", "ejs");
app.use(express.static("public"));
app.use((req, res, next) => {
  res.locals.memberId = req.session.memberId;
  next();
});


app.use((req, res, next) => {
  res.locals.memberId = req.session.memberId;

  if (req.session.memberId) {
    db.get(
      "SELECT * FROM members WHERE id = ?",
      [req.session.memberId],
      (err, member) => {
        if (err) {
          console.error(err);
          res.locals.member = null;
          res.locals.isMonthlyMember = false;
          return next();
        }

        res.locals.member = member || null;

        // 月謝会員かチェック
        const checkSql = `
          SELECT id
          FROM monthly_entries
          WHERE member_id = ?
        `;

        db.get(checkSql, [req.session.memberId], (err, entry) => {
          if (err) {
            console.error(err);
            res.locals.isMonthlyMember = false;
          } else {
            res.locals.isMonthlyMember = !!entry;
          }

          next();
        });
      }
    );
  } else {
    res.locals.member = null;
    res.locals.isMonthlyMember = false;
    next();
  }
});

app.locals.formatPlan = (plan) => {
  if (plan === 'trial') return '無料体験';
  if (plan === 'personal60' || plan === 'lesson') return 'パーソナルレッスン 60分';
  if (plan === 'personal30') return 'パーソナルレッスン 30分';
  if (plan === 'reschedule') return '振替';
  if (plan === 'elementary_reschedule') return '小学生振替';
  if (plan === 'junior_reschedule') return '中学生振替';
  return plan;
};

app.locals.formatCourse = (course) => {
  if (course === 'elementary_wed') return '小学生週1回（水曜日）';
  if (course === 'elementary_fri') return '小学生週1回（金曜日）';
  if (course === 'elementary_twice') return '小学生週2回';
  if (course === 'junior_wed') return '中学生週1回（水曜日）';
  if (course === 'junior_fri') return '中学生週1回（金曜日）';
  if (course === 'junior_twice') return '中学生週2回';
  return course;
};

function requireAdmin(req, res, next) {
  if (!req.session.isAdmin) {
    return res.redirect('/admin/login');
  }
  next();
}

app.get("/", (req, res) => {
  db.all(
    "SELECT * FROM menus WHERE is_active = 1 AND type != 'subscription' ORDER BY sort_order ASC",
    (err, rows) => {
      if (err) {
        console.error(err);
        return res.send("メニュー取得エラー");
      }

      res.render("reserve", { menus: rows });
    }
  );
});

app.get("/monthly", (req, res) => {
  db.all(
    "SELECT * FROM menus WHERE is_active = 1 AND (type = 'subscription' OR type = 'ticket') ORDER BY sort_order ASC",
    (err, rows) => {
      if (err) {
        console.error(err);
        return res.send("月謝メニュー取得エラー");
      }

      res.render("monthly", { menus: rows });
    }
  );
});

app.get("/date-select", (req, res) => {
  const plan = req.query.plan || "";
  const rawPlan = req.query.plan || "";
  console.log("plan:", rawPlan);

  let planName = "未選択";
  if (rawPlan === "trial") planName = "無料体験";
  if (rawPlan === "lesson" || rawPlan === "personal60") planName = "パーソナルレッスン 60分";
  if (rawPlan === "personal30") planName = "パーソナルレッスン 30分";
  if (rawPlan === "reschedule") planName = "月極会員 振替";
  if (rawPlan === "elementary_reschedule") planName = "小学生振替";
  if (rawPlan === "junior_reschedule") planName = "中学生振替";

  function proceedDateSelect(memberCourse = null) {
    db.get("SELECT * FROM menus WHERE type = ?", [plan], (err, menu) => {
      if (err) {
        console.error(err);
        return res.send("menu取得エラー");
      }

      if (!menu) {
        return res.send("対象メニューが見つかりません");
      }

      let slotsSql = `
        SELECT 
          s.*,
          COUNT(r.id) as reserved_count
        FROM slots s
        LEFT JOIN reservations r
          ON r.slot_id = s.id
          AND r.status = 'active'
        WHERE s.menu_id = ? AND s.is_active = 1
      `;

      const params = [menu.id];

      // 振替のときだけ、所属曜日の逆曜日に絞る
      if (plan === "elementary_reschedule" || plan === "junior_reschedule") {
        if (
          memberCourse === "elementary_wed" ||
          memberCourse === "junior_wed"
        ) {
          // 水曜所属 → 金曜振替だけ表示
          slotsSql += ` AND strftime('%w', s.date) = '5'`;
        }

        if (
          memberCourse === "elementary_fri" ||
          memberCourse === "junior_fri"
        ) {
          // 金曜所属 → 水曜振替だけ表示
          slotsSql += ` AND strftime('%w', s.date) = '3'`;
        }

        if (
          memberCourse === "elementary_twice" ||
          memberCourse === "junior_twice"
        ) {
          // 週2回 → 水曜・金曜どちらも表示
          slotsSql += ` AND strftime('%w', s.date) IN ('3', '5')`;
        }
      }

      slotsSql += `
        GROUP BY s.id
        ORDER BY s.date ASC, s.start_time ASC
      `;

      db.all(slotsSql, params, (err, slots) => {
        if (err) {
          console.error(err);
          return res.send("slots取得エラー");
        }

        res.render("date-select", { plan: planName, slots });
      });
    });
  }

  if (plan === "elementary_reschedule" || plan === "junior_reschedule") {
    if (!req.session.memberId) {
      return res.redirect("/members/login?next=/reschedule&msg=reschedule");
    }

    const absenceSql = `
      SELECT COUNT(*) AS count
      FROM absences
      WHERE member_id = ?
        AND used = 0
    `;

    return db.get(absenceSql, [req.session.memberId], (err, row) => {
      if (err) {
        console.error(err);
        return res.send("欠席情報の確認に失敗しました");
      }

      if (!row || row.count === 0) {
        return res.send("振替予約をするには、先に欠席登録が必要です");
      }

      const monthlySql = `
        SELECT course
        FROM monthly_entries
        WHERE member_id = ?
      `;

      db.get(monthlySql, [req.session.memberId], (err, monthlyEntry) => {
        if (err) {
          console.error(err);
          return res.send("月謝会員情報の取得に失敗しました");
        }

        if (!monthlyEntry) {
          return res.send("月謝会員情報が見つかりません");
        }

        proceedDateSelect(monthlyEntry.course);
      });
    });
  }

  proceedDateSelect();
});

app.get('/reschedule', (req, res) => {
  if (!req.session.memberId) {
    return res.redirect('/members/login?next=/reschedule&msg=reschedule');
  }

  const done = req.query.done || '';

  const sql = `
    SELECT course
    FROM monthly_entries
    WHERE member_id = ?
  `;

  db.get(sql, [req.session.memberId], (err, row) => {
    if (err) {
      console.error(err);
      return res.send('会員情報の取得に失敗しました');
    }

    if (!row) {
      return res.send('月謝会員のみ利用できます');
    }

    res.render('reschedule', {
      course: row.course,
      done
    });
  });
});
  app.get("/guest-form", (req, res) => {
    const rawPlan = req.query.plan || "";
    const rawDate = req.query.date || ""; 
    const rawTime = req.query.time || "";
  
    let planName = "未選択";
    if (rawPlan === "trial") planName = "無料体験";
    if (rawPlan === "personal60") planName = "パーソナルレッスン 60分";
    if (rawPlan === "personal30") planName = "パーソナルレッスン 30分";
    if (rawPlan === "reschedule") planName = "月極会員 振替";
  
    let dateName = "未選択";
    if (rawDate) {
      const parts = rawDate.split("-");
      if (parts.length === 3) {
        dateName = `${parts[0]}年${Number(parts[1])}月${Number(parts[2])}日`;
      }
    }
  
    res.render("guest-form", {
      plan: planName,
      rawPlan: rawPlan,
      date: dateName,
      rawDate: rawDate,
      time: rawTime || "未選択",
      slotId: req.query.slotId || ""
    });
  });

  app.get("/confirm", (req, res) => {
    const rawPlan = req.query.plan || "";
    const rawDate = req.query.rawDate || "";
    const rawTime = req.query.time || "";
  
    const dateName = req.query.date || "未選択";
  
    let planName = "未選択";
    if (rawPlan === "trial") planName = "無料体験";
    if (rawPlan === "lesson" || rawPlan === "personal60") planName = "パーソナルレッスン 60分";
    if (rawPlan === "personal30") planName = "パーソナルレッスン 30分";
    if (rawPlan === "reschedule") planName = "月極会員 振替";
    if (rawPlan === "elementary_reschedule") planName = "小学生振替";
    if (rawPlan === "junior_reschedule") planName = "中学生振替";
  
    res.render("confirm", {
      plan: planName,
      rawPlan: rawPlan,
      date: dateName,
      rawDate: rawDate,
      time: rawTime || "未選択",
      slotId: req.query.slotId || "",
      parentName: req.query.parentName || "",
      childName: req.query.childName || "",
      childKana: req.query.childKana || "",
      grade: req.query.grade || "",
      email: req.query.email || "",
      phone: req.query.phone || "",
      note: req.query.note || ""
    });
  });

  app.post("/complete", (req, res) => {
    const {
      plan,
      date,
      rawDate,
      time,
      slotId,
      parentName,
      childName,
      childKana,
      grade,
      email,
      phone,
      note
    } = req.body;
  
    const cleanDate = rawDate;
    const cleanChildName = childName.trim();
  
    if (!cleanDate) {
      return res.status(400).send("日付の形式が正しくありません");
    }
  
    let planLabel = plan;
    if (plan === "trial") planLabel = "無料体験";
    if (plan === "personal60" || plan === "lesson") planLabel = "パーソナルレッスン 60分";
    if (plan === "personal30") planLabel = "パーソナルレッスン 30分";
  
    const checkSql = `
      SELECT
        slots.capacity,
        COUNT(reservations.id) AS reserved_count
      FROM slots
      LEFT JOIN reservations
        ON slots.id = reservations.slot_id
        AND reservations.status = 'active'
      WHERE slots.id = ?
      GROUP BY slots.id
    `;
  
    db.get(checkSql, [slotId], (err, slotInfo) => {
      if (err) {
        return res.status(500).send("空き状況の確認に失敗しました");
      }
  
      if (!slotInfo) {
        return res.status(404).send("対象の予約枠が見つかりません");
      }
  
      if (slotInfo.reserved_count >= slotInfo.capacity) {
        return res.send("この予約枠は満席です");
      }
  
      const duplicateSql = `
        SELECT id
        FROM reservations
        WHERE slot_id = ?
          AND email = ?
          AND child_name = ?
          AND status = 'active'
      `;
  
      db.get(duplicateSql, [slotId, email, cleanChildName], (err, existing) => {
        if (err) {
          return res.status(500).send("重複予約の確認に失敗しました");
        }
  
        if (existing) {
          return res.send("この予約枠はすでに予約済みです");
        }
  
        const insertSql = `
          INSERT INTO reservations
          (plan, slot_id, date, time, parent_name, child_name, child_kana, grade, email, phone, note)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
  
        db.run(
          insertSql,
          [
            plan,
            slotId,
            cleanDate,
            time,
            parentName,
            cleanChildName,
            childKana,
            grade,
            email,
            phone,
            note || ""
          ],
          function (err) {
            if (err) {
              console.error(err);
              return res.status(500).send("予約保存に失敗しました");
            }
  
            resend.emails.send({
              from: "info@sieg-sports.com",
              to: "yurie6312@gmail.com",
              subject: "新しい予約が入りました",
              html: `
                <h2>新しい予約が入りました</h2>
                <p><strong>プラン</strong>：${planLabel}</p>
                <p><strong>日付</strong>：${cleanDate}</p>
                <p><strong>時間</strong>：${time}</p>
                <p><strong>保護者名</strong>：${parentName}</p>
                <p><strong>お子さま名</strong>：${cleanChildName}</p>
                <p><strong>学年</strong>：${grade}</p>
                <p><strong>メール</strong>：${email}</p>
                <p><strong>電話番号</strong>：${phone}</p>
                <p><strong>備考</strong>：${note || "なし"}</p>
              `
            }).then((result) => {
              console.log("メール送信成功:", result);
            }).catch((error) => {
              console.error("メール送信失敗:", error);
            });
  
            resend.emails.send({
              from: "info@sieg-sports.com",
              to: email,
              subject: "【ジークスポーツ】ご予約ありがとうございます",
              html: `
                <h2>ご予約ありがとうございます</h2>
  
                <p>${parentName || cleanChildName} 様</p>
  
                <p>
                  この度はジークスポーツのご予約ありがとうございます。<br>
                  以下の内容でご予約を承りました。
                </p>
  
                <hr>
  
                <p><strong>プラン</strong>：${planLabel}</p>
                <p><strong>日付</strong>：${cleanDate}</p>
                <p><strong>時間</strong>：${time}</p>
                <p><strong>お名前</strong>：${cleanChildName}</p>
                <p><strong>学年</strong>：${grade}</p>
  
                <hr>
  
                <p>
                  当日は動きやすい服装でお越しください。<br>
                  また、開始5分前を目安にお越しください。
                </p>
  
                <br>
  
                <p>
                  当日のご連絡はLINEにて行っておりますので、<br>
                  事前にご登録をお願いいたします。
                </p>
  
                <p style="text-align:center; margin:16px 0;">
                  <a href="https://lin.ee/nGbTf8c" style="
                    display:inline-block;
                    padding:12px 20px;
                    background:#06C755;
                    color:#fff;
                    text-decoration:none;
                    border-radius:6px;
                    font-weight:bold;
                  ">
                    LINE登録はこちら
                  </a>
                </p>
  
                <p>
                  ご不明点がございましたら、お気軽にお問い合わせください。
                </p>
  
                <br>
  
                <p>当日お会いできるのを楽しみにしております。</p>
  
                <p>
                  ───────────────<br>
                  ジークスポーツ<br>
                  ───────────────
                </p>
              `
            }).then((result) => {
              console.log("ユーザー向けメール送信成功:", result);
            }).catch((error) => {
              console.error("ユーザー向けメール送信失敗:", error);
            });
  
            res.render("complete");
          }
        );
      });
    });
  });
   
  app.get("/admin/reservations", requireAdmin,(req, res) => {
    db.all("SELECT * FROM reservations ORDER BY id DESC", (err, rows) => {
      if (err) {
        console.error(err);
        return res.send("予約一覧の取得に失敗しました");
      }
  
      res.render("admin", { reservations: rows });
    });
  });

  


  

  
  app.get('/admin/slots', requireAdmin,(req, res) => {
    const error = req.query.error || '';
    const success = req.query.success || '';
    const start_date = req.query.start_date || '';
    const end_date = req.query.end_date || '';
    const menu_id = req.query.menu_id || '';
  
    let slotsSql = `
    SELECT
    slots.*,
    menus.name AS menu_name,
    menus.type AS menu_type,
    COUNT(reservations.id) AS reserved_count
      FROM slots
      JOIN menus ON slots.menu_id = menus.id
      LEFT JOIN reservations
        ON slots.id = reservations.slot_id
        AND reservations.status = 'active'
    `;
  
    const params = [];
    const conditions = [];
  
    if (start_date && end_date) {
      conditions.push(`slots.date BETWEEN ? AND ?`);
      params.push(start_date, end_date);
    }
  
    if (menu_id) {
      conditions.push(`slots.menu_id = ?`);
      params.push(menu_id);
    }
  
    if (conditions.length > 0) {
      slotsSql += ` WHERE ` + conditions.join(' AND ');
    }
  
    slotsSql += `
      GROUP BY slots.id
      ORDER BY slots.date, slots.start_time
    `;
    const menusSql = `
    SELECT * FROM menus
    WHERE is_active = 1
      AND type IN (
        'trial',
        'lesson',
        'elementary_reschedule',
        'junior_reschedule'
      )
    ORDER BY id
  `;
    db.all(slotsSql, params, (err, slots) => {
      if (err) {
        console.error('admin/slots slots取得エラー詳細:', err);
        console.error('実行SQL:', slotsSql);
        console.error('params:', params);
        return res.status(500).send('slots取得エラー');
      }
  
      db.all(menusSql, (err, menus) => {
        if (err) {
          console.error('admin/slots menus取得エラー詳細:', err);
          return res.status(500).send('menus取得エラー');
        }
  
        res.render('admin-slots', {
          slots,
          menus,
          error,
          success,
          start_date,
          end_date,
          menu_id
        });
      });
    });
  });
 
  app.post("/admin/add-slot", requireAdmin, (req, res) => {
    let { menu_ids, date, start_time, end_time, capacity } = req.body;
  
    if (!menu_ids) {
      return res.redirect("/admin/slots?error=menu");
    }
  
    if (!Array.isArray(menu_ids)) {
      menu_ids = [menu_ids];
    }
  
    const sql = `
      INSERT INTO slots (menu_id, date, start_time, end_time, capacity, is_active)
      VALUES (?, ?, ?, ?, ?, 1)
    `;
  
    let completed = 0;
  
    menu_ids.forEach(menu_id => {
      db.run(sql, [menu_id, date, start_time, end_time, capacity], function (err) {
        if (err) {
          console.error(err);
          return res.send("slot追加失敗");
        }
  
        completed++;
  
        if (completed === menu_ids.length) {
          res.redirect("/admin/slots?success=スロットを追加しました");
        }
      });
    });
  });

  app.post("/admin/delete-slot", requireAdmin,(req, res) => {
    const { id } = req.body;
  
    db.run("DELETE FROM slots WHERE id = ?", [id], function (err) {
      if (err) {
        console.error(err);
        return res.send("slot削除失敗");
      }
  
      res.redirect("/admin/slots");
    });
  });

  app.post('/admin/slots/delete-selected', requireAdmin, (req, res) => {
    let { slot_ids } = req.body;
  
    if (!slot_ids) {
      return res.redirect('/admin/slots?error=削除するスロットを選択してください');
    }
  
    if (!Array.isArray(slot_ids)) {
      slot_ids = [slot_ids];
    }
  
    const placeholders = slot_ids.map(() => '?').join(',');
  
    const sql = `
      DELETE FROM slots
      WHERE id IN (${placeholders})
    `;
  
    db.run(sql, slot_ids, function (err) {
      if (err) {
        console.error(err);
        return res.redirect('/admin/slots?error=スロットの削除に失敗しました');
      }
  
      res.redirect('/admin/slots?success=選択したスロットを削除しました');
    });
  });

  app.post("/admin/add-slots-bulk", requireAdmin, (req, res) => {
    let {
      menu_ids,
      dates,
      start_time,
      end_time,
      slot_minutes,
      interval_minutes,
      capacity
    } = req.body;
  
    if (!menu_ids) {
      return res.send("メニューを選択してください");
    }
  
    if (!Array.isArray(menu_ids)) {
      menu_ids = [menu_ids];
    }
  
    const dateList = (dates || "")
      .split(",")
      .map(d => d.trim())
      .filter(Boolean);
      const slotMinutes = Number(slot_minutes || 0);
      const intervalMinutes = Number(interval_minutes || 0);

      function timeToMinutes(time) {
        const [hours, minutes] = time.split(":").map(Number);
        return hours * 60 + minutes;
      }
      
      function minutesToTime(totalMinutes) {
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
      
        return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
      }

      const timeSlots = [];

if (slotMinutes > 0) {
  let current = timeToMinutes(start_time);
  const end = timeToMinutes(end_time);

  while (current + slotMinutes <= end) {
    const slotStart = minutesToTime(current);
    const slotEnd = minutesToTime(current + slotMinutes);

    timeSlots.push({
      start_time: slotStart,
      end_time: slotEnd
    });

    current += slotMinutes + intervalMinutes;
  }
} else {
  timeSlots.push({
    start_time,
    end_time
  });
}

  
    if (dateList.length === 0) {
      return res.send("日付が選択されていません");
    }
  
    const sql = `
      INSERT INTO slots (menu_id, date, start_time, end_time, capacity, is_active)
      VALUES (?, ?, ?, ?, ?, 1)
    `;
  
    const total = dateList.length * menu_ids.length * timeSlots.length;
    let completed = 0;
    let hasError = false;
    
    dateList.forEach(date => {
      menu_ids.forEach(menu_id => {
        timeSlots.forEach(slot => {
          db.run(
            sql,
            [menu_id, date, slot.start_time, slot.end_time, capacity],
            function (err) {
              if (hasError) return;
    
              if (err) {
                hasError = true;
                console.error(err);
                return res.send("複数slot追加失敗");
              }
    
              completed++;
    
              if (completed === total) {
                res.redirect("/admin/slots?success=スロットを追加しました");
              }
            }
          );
        });
      });
    });
  });
    
    

  app.post('/admin/add-slots-pattern',requireAdmin, (req, res) => {
    const {
      menu_id,
      weekday,
      start_date,
      end_date,
      start_time,
      end_time,
      capacity
    } = req.body;

    if (!menu_id || !weekday || !start_date || !end_date || !start_time || !end_time || !capacity) {
      return res.redirect('/admin/slots?error=すべての項目を入力してください');
    }
  
    const targetWeekday = Number(weekday);
  
    const matchedDates = [];
  
    let current = new Date(start_date);
    const end = new Date(end_date);
  
    while (current <= end) {
      if (current.getDay() === targetWeekday) {
        const yyyy = current.getFullYear();
        const mm = String(current.getMonth() + 1).padStart(2, '0');
        const dd = String(current.getDate()).padStart(2, '0');
        const formattedDate = `${yyyy}-${mm}-${dd}`;
  
        matchedDates.push(formattedDate);
      }
  
      current.setDate(current.getDate() + 1);
    }
  
    if (matchedDates.length === 0) {
      return res.redirect('/admin/slots');
    }
  
    let completed = 0;
    let hasError = false;
    let duplicateFound = false;
  
    const checkSql = `
      SELECT id
      FROM slots
      WHERE menu_id = ?
        AND date = ?
        AND start_time = ?
        AND end_time = ?
    `;
  
    const insertSql = `
      INSERT INTO slots (menu_id, date, start_time, end_time, capacity, is_active)
      VALUES (?, ?, ?, ?, ?, 1)
    `;
  
    matchedDates.forEach((date) => {
      db.get(checkSql, [menu_id, date, start_time, end_time], (err, existingSlot) => {
        if (err) {
          console.error('重複確認エラー:', err);
          hasError = true;
          completed++;
  
          if (completed === matchedDates.length) {
            return res.status(500).send('曜日パターン追加中にエラーが発生しました');
          }
          return;
        }
  
        // すでに同じslotがある場合
if (existingSlot) {
  console.log('重複見つかった:', date);
  duplicateFound = true;
  completed++;

  if (completed === matchedDates.length) {
    if (hasError) {
      return res.status(500).send('曜日パターン追加中にエラーが発生しました');
    }

    if (duplicateFound) {
      return res.redirect('/admin/slots?error=重複するスロットがありました');
    }

    return res.redirect('/admin/slots?success=曜日パターンを追加しました');
  }
  return;
}
        
  
        // なければINSERT
        db.run(insertSql, [menu_id, date, start_time, end_time, capacity], (err) => {
          if (err) {
            console.error('曜日パターン追加エラー:', err);
            hasError = true;
          }
  
          completed++;
  
          if (completed === matchedDates.length) {
            if (hasError) {
              return res.status(500).send('曜日パターン追加中にエラーが発生しました');
            }
          
            if (duplicateFound) {
              return res.redirect('/admin/slots?error=重複するスロットがありました');
            }
          
            return res.redirect('/admin/slots?success=曜日パターンを追加しました');
          }
        });
      });
    });
  });

  
  app.get('/admin/reservations/:id', requireAdmin,(req, res) => {
    const reservationId = req.params.id;
  
    const sql = `
      SELECT *
      FROM reservations
      WHERE id = ?
    `;
  
    db.get(sql, [reservationId], (err, reservation) => {
      if (err) {
        return res.status(500).send('予約詳細の取得に失敗しました');
      }
  
      if (!reservation) {
        return res.status(404).send('予約が見つかりません');
      }
      let formattedDate = reservation.date || '';

if (formattedDate && formattedDate.includes('-')) {
  const parts = formattedDate.split('-');
  if (parts.length === 3) {
    formattedDate = `${parts[0]}年${Number(parts[1])}月${Number(parts[2])}日`;
  }
}

      
  
res.render('admin-reservation-detail', {
  reservation,
  formattedDate
});
    });
  });

  app.get('/members/new', (req, res) => {
    res.render('member-new');
  });


  app.post('/members', (req, res) => {
    const {
      name,
      kana,
      grade,
      email,
      phone,
      guardian_name,
      note,
      password
    } = req.body;
  
    const checkSql = `
      SELECT id, name, password
      FROM members
      WHERE email = ?
    `;
  
    db.all(checkSql, [email], async (err, existingMembers) => {
      if (err) {
        console.error(err);
        return res.status(500).send('会員確認に失敗しました');
      }
  
      try {
        // ① 同じメール + 同じ名前 はNG
        const sameNameMember = existingMembers.find(member => member.name === name);
        if (sameNameMember) {
          return res.send('同じお名前・メールアドレスの会員がすでに登録されています');
        }
  
        // ② 同じメール + 同じパスワード もNG
        for (const member of existingMembers) {
          const samePassword = await bcrypt.compare(password, member.password);
          if (samePassword) {
            return res.send('同じメールアドレスでは別のパスワードを設定してください');
          }
        }
  
        // ③ 新規登録
        const hashedPassword = await bcrypt.hash(password, 10);
  
        const insertSql = `
          INSERT INTO members (
            name,
            kana,
            grade,
            email,
            phone,
            guardian_name,
            note,
            password
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;
  
        db.run(
          insertSql,
          [name, kana, grade, email, phone, guardian_name, note, hashedPassword],
          function (err) {
            if (err) {
              console.error(err);
              return res.status(500).send('会員登録に失敗しました');
            }
  
            res.redirect('/members/login?registered=1');
          }
        );
      } catch (error) {
        console.error(error);
        return res.status(500).send('会員登録処理に失敗しました');
      }
    });
  });

  app.get('/members/login', (req, res) => {
    const registered = req.query.registered || '';
    const next = req.query.next || '';
    const msg = req.query.msg || '';
  
    res.render('member-login', { registered, next, msg });
  });

  app.get('/members/:id', (req, res) => {
    const memberId = req.params.id;
  
    const sql = `
      SELECT *
      FROM members
      WHERE id = ?
    `;
  
    db.get(sql, [memberId], (err, member) => {
      if (err) {
        return res.status(500).send('会員情報の取得に失敗しました');
      }
  
      if (!member) {
        return res.status(404).send('会員が見つかりません');
      }
  
      res.render('member-detail', { member });
    });
  });


  app.post('/members/login', (req, res) => {
    const { email, password } = req.body;
  
    const sql = `
      SELECT *
      FROM members
      WHERE email = ?
    `;
  
    db.all(sql, [email], async (err, members) => {
      if (err) {
        console.error(err);
        return res.status(500).send('ログインに失敗しました');
      }
  
      if (!members || members.length === 0) {
        return res.send('メールアドレスが間違っています');
      }
  
      try {
        let matchedMember = null;
  
        for (const member of members) {
          const ok = await bcrypt.compare(password, member.password);
          if (ok) {
            matchedMember = member;
            break;
          }
        }
  
        if (!matchedMember) {
          return res.send('パスワードが間違っています');
        }
  
        req.session.memberId = matchedMember.id;
  
        const next = req.body.next || '/';
        res.redirect(next);
      } catch (error) {
        console.error(error);
        return res.status(500).send('ログイン処理に失敗しました');
      }
    });
  });

  app.get('/member-reserve', (req, res) => {
    const { plan, date, time, slotId } = req.query;
    console.log('member-reserve plan:', plan);
  
    if (!req.session.memberId) {
      return res.redirect('/members/login');
    }
  
    const sql = `
      SELECT *
      FROM members
      WHERE id = ?
    `;
  
    db.get(sql, [req.session.memberId], (err, member) => {
      if (err) {
        return res.status(500).send('会員情報の取得に失敗しました');
      }
  
      if (!member) {
        return res.status(404).send('会員が見つかりません');
      }
  
      res.render('member-reserve', {
        plan,
        date,
        time,
        slotId,
        member
      });
    });
  });

  app.post('/member-reserve', (req, res) => {
    const { plan, date, time, slotId } = req.body;
  
    if (!req.session.memberId) {
      return res.redirect('/members/login');
    }
  
    const memberSql = `
      SELECT *
      FROM members
      WHERE id = ?
    `;
  
    db.get(memberSql, [req.session.memberId], (err, member) => {
      if (err) {
        return res.status(500).send('会員情報の取得に失敗しました');
      }
  
      if (!member) {
        return res.status(404).send('会員が見つかりません');
      }
  
      const checkSql = `
        SELECT
          slots.capacity,
          COUNT(reservations.id) AS reserved_count
        FROM slots
        LEFT JOIN reservations
          ON slots.id = reservations.slot_id
          AND reservations.status = 'active'
        WHERE slots.id = ?
        GROUP BY slots.id
      `;
  
      db.get(checkSql, [slotId], (err, slotInfo) => {
        if (err) {
          return res.status(500).send('空き状況の確認に失敗しました');
        }
  
        if (!slotInfo) {
          return res.status(404).send('対象の予約枠が見つかりません');
        }
  
        if (slotInfo.reserved_count >= slotInfo.capacity) {
          return res.send('この予約枠は満席です');
        }
  
        const duplicateSql = `
          SELECT id
          FROM reservations
          WHERE slot_id = ?
            AND member_id = ?
            AND status = 'active'
        `;
  
        db.get(duplicateSql, [slotId, req.session.memberId], (err, existing) => {
          if (err) {
            return res.status(500).send('重複予約の確認に失敗しました');
          }
  
          if (existing) {
            return res.send('この予約枠はすでに予約済みです');
          }
  
          const insertSql = `
            INSERT INTO reservations (
              member_id,
              plan,
              slot_id,
              date,
              time,
              parent_name,
              child_name,
              child_kana,
              grade,
              email,
              phone,
              note
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `;
  
          const values = [
            req.session.memberId,
            plan,
            slotId,
            date,
            time,
            member.guardian_name || '',
            member.name,
            member.kana,
            member.grade,
            member.email,
            member.phone,
            member.note || ''
          ];
  
          db.run(insertSql, values, function (err) {
            if (err) {
              console.error(err);
              return res.status(500).send('予約の保存に失敗しました');
            }

            let planLabel = plan;

            if (plan === 'trial') planLabel = '無料体験';
            if (plan === 'lesson') planLabel = 'パーソナルレッスン 60分';
            if (plan === 'personal30') planLabel = 'パーソナルレッスン 30分';
            if (plan === 'elementary_reschedule') planLabel = '小学生振替';
            if (plan === 'junior_reschedule') planLabel = '中学生振替';
  
            if (plan === 'elementary_reschedule' || plan === 'junior_reschedule') {
              const useAbsenceSql = `
                UPDATE absences
                SET used = 1
                WHERE id = (
                  SELECT id
                  FROM absences
                  WHERE member_id = ?
                    AND used = 0
                  ORDER BY absence_date ASC
                  LIMIT 1
                )
              `;
  
              db.run(useAbsenceSql, [req.session.memberId], (err) => {
                if (err) {
                  console.error('欠席消費エラー:', err);
                  return res.status(500).send('振替処理に失敗しました');
                }
  
                console.log('欠席1件を消費しました');
                sendEmailsAndComplete();
              });
            } else {
              sendEmailsAndComplete();
            }

            


  
            function sendEmailsAndComplete() {
              resend.emails.send({
                from: 'info@sieg-sports.com',
                to: 'yurie6312@gmail.com',
                subject: '【会員予約】新しい予約が入りました',
                html: `
                  <h2>会員予約が入りました</h2>
                  <p><strong>プラン</strong>：${planLabel}</p>
                  <p><strong>日付</strong>：${date}</p>
                  <p><strong>時間</strong>：${time}</p>
                  <p><strong>会員名</strong>：${member.name}</p>
                  <p><strong>保護者名</strong>：${member.guardian_name || 'なし'}</p>
                  <p><strong>学年</strong>：${member.grade}</p>
                  <p><strong>メール</strong>：${member.email}</p>
                  <p><strong>電話番号</strong>：${member.phone}</p>
                  <p><strong>備考</strong>：${member.note || 'なし'}</p>
                `
              }).then((result) => {
                console.log('会員予約メール送信成功:', result);
              }).catch((error) => {
                console.error('会員予約メール送信失敗:', error);
              });
  
              resend.emails.send({
                from: 'info@sieg-sports.com',
                to: member.email,
                subject: '【ジークスポーツ】ご予約ありがとうございます',
                html: `
                  <h2>ご予約ありがとうございます</h2>
                  <p>${member.guardian_name || member.name} 様</p>
  
                  <p>以下の内容でご予約を承りました。</p>
  
                  <hr>
  
                  <p><strong>プラン</strong>：${planLabel}</p>
                  <p><strong>日付</strong>：${date}</p>
                  <p><strong>時間</strong>：${time}</p>
                  <p><strong>お名前</strong>：${member.name}</p>
                  <p><strong>学年</strong>：${member.grade}</p>
  
                  <hr>
  
                  <p>当日お会いできるのを楽しみにしております。</p>
                  <p>ジークスポーツ</p>
                `
              }).then((result) => {
                console.log('会員本人向けメール送信成功:', result);
              }).catch((error) => {
                console.error('会員本人向けメール送信失敗:', error);
              });
  
              res.render('complete');
            }
          });
        });
      });
    });
  });

  app.get('/mypage', (req, res) => {
    if (!req.session.memberId) {
      return res.redirect('/members/login');
    }
  
    const memberSql = `
      SELECT *
      FROM members
      WHERE id = ?
    `;
  
    const reservationSql = `
      SELECT *
      FROM reservations
      WHERE member_id = ?
      ORDER BY date DESC, time DESC
    `;
  
    const absenceSql = `
      SELECT *
      FROM absences
      WHERE member_id = ?
      ORDER BY absence_date DESC
    `;
  
    db.get(memberSql, [req.session.memberId], (err, member) => {
      if (err) {
        return res.status(500).send('会員情報の取得に失敗しました');
      }
  
      if (!member) {
        return res.status(404).send('会員が見つかりません');
      }
  
      db.all(reservationSql, [req.session.memberId], (err, reservations) => {
        if (err) {
          return res.status(500).send('予約履歴の取得に失敗しました');
        }
  
        db.all(absenceSql, [req.session.memberId], (err, absences) => {
          if (err) {
            return res.status(500).send('欠席履歴の取得に失敗しました');
          }
  
          const normalReservations = reservations.filter(r =>
            r.plan !== 'elementary_reschedule' && r.plan !== 'junior_reschedule'
          );
  
          const rescheduleReservations = reservations.filter(r =>
            r.plan === 'elementary_reschedule' || r.plan === 'junior_reschedule'
          );
  
          res.render('mypage', {
            member,
            reservations,
            normalReservations,
            rescheduleReservations,
            absences
          });
        });
      });
    });
  });
  app.get('/mypage/member', (req, res) => {
    if (!req.session.memberId) {
      return res.redirect('/members/login');
    }
  
    const memberSql = `
      SELECT *
      FROM members
      WHERE id = ?
    `;
  
    const monthlySql = `
      SELECT *
      FROM monthly_entries
      WHERE member_id = ?
    `;
  
    db.get(memberSql, [req.session.memberId], (err, member) => {
      if (err) {
        console.error(err);
        return res.status(500).send('会員情報の取得に失敗しました');
      }
  
      if (!member) {
        return res.status(404).send('会員が見つかりません');
      }
  
      db.get(monthlySql, [req.session.memberId], (err, monthlyEntry) => {
        if (err) {
          console.error(err);
          return res.status(500).send('月謝会員情報の取得に失敗しました');
        }
  
        res.render('mypage-member', {
          member,
          monthlyEntry
        });
      });
    });
  });

  app.get('/mypage/reservations', (req, res) => {
    if (!req.session.memberId) {
      return res.redirect('/members/login');
    }
  
    const sql = `
  SELECT *
  FROM reservations
  WHERE member_id = ?
    AND status = 'active'
  ORDER BY date DESC, time DESC
`;
  
    db.all(sql, [req.session.memberId], (err, reservations) => {
      if (err) {
        return res.status(500).send('予約履歴の取得に失敗しました');
      }
  
      res.render('mypage-reservations', {
        reservations,
        cancel: req.query.cancel
      });
    });
  });
  app.post('/mypage/reservations/:id/cancel', (req, res) => {
    if (!req.session.memberId) {
      return res.redirect('/members/login');
    }
  
    const reservationId = req.params.id;
  
    // 自分の予約かチェック
    const checkSql = `
      SELECT *
      FROM reservations
      WHERE id = ?
        AND member_id = ?
    `;
  
    db.get(checkSql, [reservationId, req.session.memberId], (err, reservation) => {
      if (err) {
        return res.status(500).send('予約確認に失敗しました');
      }
  
      if (!reservation) {
        return res.status(403).send('この予約はキャンセルできません');
      }
  
      // 削除
      const updateSql = `
  UPDATE reservations
  SET status = 'canceled'
  WHERE id = ?
`;

db.run(updateSql, [reservationId], function (err) {
  if (err) {
    return res.status(500).send('キャンセルに失敗しました');

  }

  resend.emails.send({
    from: 'info@sieg-sports.com',
    to: 'yurie6312@gmail.com',
    subject: '【キャンセル】予約がキャンセルされました',
    html: `
      <h2>予約がキャンセルされました</h2>
  
      <p><strong>予約ID</strong>：${reservation.id}</p>
      <p><strong>プラン</strong>：${reservation.plan}</p>
      <p><strong>日付</strong>：${reservation.date}</p>
      <p><strong>時間</strong>：${reservation.time}</p>
      <p><strong>お名前</strong>：${reservation.child_name}</p>
      <p><strong>メール</strong>：${reservation.email}</p>
    `
  }).then((result) => {
    console.log('キャンセルメール送信成功:', result);
  }).catch((error) => {
    console.error('キャンセルメール送信失敗:', error);
  });

  res.redirect('/mypage/reservations?cancel=1');
});
    });
  });

  app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).send('ログアウトに失敗しました');
      }
  
      res.redirect('/');
    });
  });

  app.get('/monthly-entry', (req, res) => {
    if (!req.session.memberId) {
      return res.redirect('/members/login?next=/monthly-entry');
    }
  
    res.render('monthly-entry');
  });


  app.get('/monthly-entry/complete', (req, res) => {
    res.render('monthly-entry-complete');
  });

  app.post('/monthly-entry', (req, res) => {
    // ログインチェック
    if (!req.session.memberId) {
      return res.redirect('/members/login');
    }
  
    const {
      school_name,
      birth_date,
      course,
      start_month,
      sns_permission,
      agree_rule
    } = req.body;
  
    // 規約チェック
    if (!agree_rule) {
      return res.send('規約への同意が必要です');
    }
  
    // 会員情報取得
    const memberSql = `
      SELECT *
      FROM members
      WHERE id = ?
    `;
  
    db.get(memberSql, [req.session.memberId], (err, member) => {
      if (err) {
        console.error(err);
        return res.send('会員情報の取得に失敗しました');
      }
  
      if (!member) {
        return res.send('会員情報が見つかりません');
      }
  
      // すでに入会済みかチェック
      const checkSql = `
        SELECT id
        FROM monthly_entries
        WHERE member_id = ?
      `;
  
      db.get(checkSql, [req.session.memberId], (err, existingEntry) => {
        if (err) {
          console.error(err);
          return res.send('入会情報の確認に失敗しました');
        }
  
        if (existingEntry) {
          return res.send('すでに月謝会員として登録されています。変更がある場合はご連絡ください。');
        }
  
        // 入会情報保存
        const insertSql = `
          INSERT INTO monthly_entries (
            member_id,
            school_name,
            birth_date,
            course,
            start_month,
            sns_permission
          ) VALUES (?, ?, ?, ?, ?, ?)
        `;
  
        db.run(
          insertSql,
          [
            req.session.memberId,
            school_name,
            birth_date,
            course,
            start_month,
            sns_permission
          ],
          function (err) {
            if (err) {
              console.error(err);
              return res.send('入会申請に失敗しました');
            }
  
            // コース表示用
            let courseLabel = course;
            if (course === 'elementary_wed') courseLabel = '小学生週1回（水曜日16:00〜17:00）';
            if (course === 'elementary_fri') courseLabel = '小学生週1回（金曜日17:00〜18:00）';
            if (course === 'elementary_twice') courseLabel = '小学生週2回';
            if (course === 'junior_wed') courseLabel = '中学生週1回（水曜日17:30〜18:30）';
            if (course === 'junior_fri') courseLabel = '中学生週1回（金曜日18:30〜19:30）';
            if (course === 'junior_twice') courseLabel = '中学生週2回';
  
            // SNS掲載表示用
            let snsPermissionLabel = sns_permission;
            if (sns_permission === 'ok') snsPermissionLabel = '掲載可';
            if (sns_permission === 'limited') snsPermissionLabel = '顔が分からない形なら可';
            if (sns_permission === 'ng') snsPermissionLabel = '掲載不可';
  
            // 管理者メール送信
            resend.emails.send({
              from: 'info@sieg-sports.com',
              to: 'yurie6312@gmail.com',
              subject: '【入会申請】新しい月謝会員の申請がありました',
              html: `
                <h2>新しい入会申請がありました</h2>
  
                <h3>■ 会員情報</h3>
                <p><strong>名前</strong>：${member.name || ''}</p>
                <p><strong>ふりがな</strong>：${member.kana || ''}</p>
                <p><strong>保護者名</strong>：${member.guardian_name || 'なし'}</p>
                <p><strong>メール</strong>：${member.email || ''}</p>
                <p><strong>電話</strong>：${member.phone || ''}</p>
                <p><strong>学年 / 年齢</strong>：${member.grade || ''}</p>
  
                <h3>■ 入会内容</h3>
                <p><strong>学校名</strong>：${school_name}</p>
                <p><strong>生年月日</strong>：${birth_date}</p>
                <p><strong>コース</strong>：${courseLabel}</p>
                <p><strong>入会月</strong>：${start_month}</p>
                <p><strong>SNS掲載</strong>：${snsPermissionLabel}</p>
              `
            }).then((result) => {
              console.log('入会申請メール送信成功:', result);
            }).catch((error) => {
              console.error('入会申請メール送信失敗:', error);
            });
  
            res.redirect('/monthly-entry/complete');
          }
        );
      });
    });
  });

  app.get('/admin/monthly-entries', requireAdmin,(req, res) => {
    const sql = `
      SELECT
        monthly_entries.*,
        members.name,
        members.kana,
        members.email,
        members.phone,
        members.guardian_name
      FROM monthly_entries
      LEFT JOIN members
        ON monthly_entries.member_id = members.id
      ORDER BY monthly_entries.id DESC
    `;
  
    db.all(sql, [], (err, rows) => {
      if (err) {
        console.error(err);
        return res.status(500).send('入会申請一覧の取得に失敗しました');
      }
  
      res.render('admin-monthly-entries', { entries: rows });
    });
  });

  app.get('/admin', requireAdmin,(req, res) => {
    res.render('admin-top');
  });

  app.get('/admin/canceled-reservations', requireAdmin,(req, res) => {
    const sql = `
      SELECT *
      FROM reservations
      WHERE status = 'canceled'
      ORDER BY id DESC
    `;
  
    db.all(sql, [], (err, rows) => {
      if (err) {
        console.error(err);
        return res.send('キャンセル一覧の取得に失敗しました');
      }
  
      res.render('admin-canceled-reservations', { reservations: rows });
    });
  });

  app.post('/mypage/absences', (req, res) => {
    if (!req.session.memberId) {
      return res.redirect('/members/login');
    }
  
    const { absence_date, note } = req.body;
  
    if (!absence_date) {
      return res.send('日付を選択してください');
    }
  
    // まず月謝会員情報を取得
    const monthlySql = `
      SELECT course
      FROM monthly_entries
      WHERE member_id = ?
    `;
  
    db.get(monthlySql, [req.session.memberId], (err, monthlyEntry) => {
      if (err) {
        console.error(err);
        return res.send('月謝会員情報の取得に失敗しました');
      }
  
      if (!monthlyEntry) {
        return res.send('月謝会員のみ欠席登録ができます');
      }
  
      const course = monthlyEntry.course;
  
      // 欠席日の曜日を取得（0:日, 1:月, 2:火, 3:水, 4:木, 5:金, 6:土）
      const day = new Date(absence_date).getDay();
  
      let isValidDay = false;
  
      if (course === 'elementary_wed' || course === 'junior_wed') {
        isValidDay = (day === 3); // 水曜
      }
  
      if (course === 'elementary_fri' || course === 'junior_fri') {
        isValidDay = (day === 5); // 金曜
      }
  
      if (course === 'elementary_twice' || course === 'junior_twice') {
        isValidDay = (day === 3 || day === 5); // 水曜 or 金曜
      }
  
      if (!isValidDay) {
        return res.send('登録されているコースの曜日のみ欠席登録できます');
      }
  
      // 同じ日にすでに欠席登録していないかチェック
      const checkSql = `
        SELECT id
        FROM absences
        WHERE member_id = ? AND absence_date = ?
      `;
  
      db.get(checkSql, [req.session.memberId, absence_date], (err, existing) => {
        if (err) {
          console.error(err);
          return res.send('欠席確認に失敗しました');
        }
  
        if (existing) {
          return res.send('この日はすでに欠席登録されています');
        }
  
        const insertSql = `
          INSERT INTO absences (
            member_id,
            absence_date,
            note
          ) VALUES (?, ?, ?)
        `;
  
        db.run(
          insertSql,
          [req.session.memberId, absence_date, note],
          function (err) {
            if (err) {
              console.error(err);
              return res.send('欠席登録に失敗しました');
            }
  
            res.redirect('/reschedule?done=absence');
          }
        );
      });
    });
  });

  app.get('/mypage/absences', (req, res) => {
    if (!req.session.memberId) {
      return res.redirect('/members/login');
    }
  
    const sql = `
      SELECT *
      FROM absences
      WHERE member_id = ?
      ORDER BY absence_date DESC
    `;
  
    db.all(sql, [req.session.memberId], (err, absences) => {
      if (err) {
        console.error(err);
        return res.status(500).send('欠席履歴の取得に失敗しました');
      }
  
      res.render('mypage-absences', { absences });
    });
  });

  app.get('/mypage/reschedules', (req, res) => {
    if (!req.session.memberId) {
      return res.redirect('/members/login');
    }
  
    const sql = `
      SELECT *
      FROM reservations
      WHERE member_id = ?
        AND (plan = 'elementary_reschedule' OR plan = 'junior_reschedule')
      ORDER BY date DESC, time DESC
    `;
  
    db.all(sql, [req.session.memberId], (err, reschedules) => {
      if (err) {
        console.error(err);
        return res.status(500).send('振替予約履歴の取得に失敗しました');
      }
  
      res.render('mypage-reschedules', { reschedules });
    });
  });

  app.get('/admin/members', requireAdmin,(req, res) => {
    const sql = `
      SELECT 
        m.*,
        me.course,
        me.start_month
      FROM members m
      LEFT JOIN monthly_entries me
        ON m.id = me.member_id
      ORDER BY m.id DESC
    `;
  
    db.all(sql, [], (err, members) => {
      if (err) {
        console.error('会員一覧取得エラー詳細:', err);
        return res.status(500).send('会員一覧の取得に失敗しました');
      }
  
      res.render('admin-members', { members });
    });
  });

  app.get('/admin/monthly-entries/:id/edit', requireAdmin,(req, res) => {
    const entryId = req.params.id;
  
    const sql = `
      SELECT
        monthly_entries.*,
        members.name,
        members.kana,
        members.email,
        members.phone,
        members.guardian_name,
        members.grade
      FROM monthly_entries
      LEFT JOIN members
        ON monthly_entries.member_id = members.id
      WHERE monthly_entries.id = ?
    `;
  
    db.get(sql, [entryId], (err, entry) => {
      if (err) {
        console.error(err);
        return res.status(500).send('入会者情報の取得に失敗しました');
      }
  
      if (!entry) {
        return res.status(404).send('対象の入会者情報が見つかりません');
      }
  
      res.render('admin-monthly-entry-edit', { entry });
    });
  });

  app.post('/admin/monthly-entries/:id',requireAdmin, (req, res) => {
    const entryId = req.params.id;
  
    const {
      school_name,
      birth_date,
      course,
      start_month,
      sns_permission
    } = req.body;
  
    const sql = `
      UPDATE monthly_entries
      SET
        school_name = ?,
        birth_date = ?,
        course = ?,
        start_month = ?,
        sns_permission = ?
      WHERE id = ?
    `;
  
    db.run(
      sql,
      [school_name, birth_date, course, start_month, sns_permission, entryId],
      function (err) {
        if (err) {
          console.error(err);
          return res.status(500).send('入会者情報の更新に失敗しました');
        }
  
        res.redirect('/admin/monthly-entries');
      }
    );
  });

  app.get('/admin/login', (req, res) => {
    const error = req.query.error || '';
    res.render('admin-login', { error });
  });
  
  app.post('/admin/login', (req, res) => {
    const { adminId, password } = req.body;
  
    if (
      adminId === process.env.ADMIN_ID &&
      password === process.env.ADMIN_PASSWORD
    ) {
      req.session.isAdmin = true;
      return res.redirect('/admin');
    }
  
    res.redirect('/admin/login?error=1');
  });

  app.get('/admin/logout', (req, res) => {
    req.session.destroy(() => {
      res.redirect('/admin/login');
    });
  });

  app.get('/admin/members/:id/edit', requireAdmin, (req, res) => {
    const { id } = req.params;
  
    const sql = `
      SELECT
        m.*,
        me.school_name,
        me.birth_date,
        me.course,
        me.start_month,
        me.sns_permission
      FROM members m
      LEFT JOIN monthly_entries me ON m.id = me.member_id
      WHERE m.id = ?
    `;
  
    db.get(sql, [id], (err, member) => {
      if (err) {
        console.error(err);
        return res.send('会員情報の取得に失敗しました');
      }
  
      if (!member) {
        return res.send('会員が見つかりません');
      }
  
      res.render('admin-member-edit', { member });
    });
  });


  app.post('/admin/members/:id/edit', requireAdmin, (req, res) => {
    const { id } = req.params;
  
    const {
      name,
      kana,
      grade,
      email,
      phone,
      guardian_name,
      note,
      school_name,
      birth_date,
      course,
      start_month,
      sns_permission
    } = req.body;
  
    const memberSql = `
      UPDATE members
      SET
        name = ?,
        kana = ?,
        grade = ?,
        email = ?,
        phone = ?,
        guardian_name = ?,
        note = ?
      WHERE id = ?
    `;
  
    db.run(
      memberSql,
      [name, kana, grade, email, phone, guardian_name, note, id],
      function (err) {
        if (err) {
          console.error(err);
          return res.send('会員情報の更新に失敗しました');
        }
  
        if (!course) {
          return db.run(
            `DELETE FROM monthly_entries WHERE member_id = ?`,
            [id],
            (err) => {
              if (err) {
                console.error(err);
                return res.send('月謝会員情報の削除に失敗しました');
              }
  
              res.redirect('/admin/members');
            }
          );
        }
  
        const checkSql = `
          SELECT id
          FROM monthly_entries
          WHERE member_id = ?
        `;
  
        db.get(checkSql, [id], (err, entry) => {
          if (err) {
            console.error(err);
            return res.send('月謝会員情報の確認に失敗しました');
          }
  
          if (entry) {
            const updateMonthlySql = `
              UPDATE monthly_entries
              SET
                school_name = ?,
                birth_date = ?,
                course = ?,
                start_month = ?,
                sns_permission = ?
              WHERE member_id = ?
            `;
  
            db.run(
              updateMonthlySql,
              [school_name, birth_date, course, start_month, sns_permission, id],
              (err) => {
                if (err) {
                  console.error(err);
                  return res.send('月謝会員情報の更新に失敗しました');
                }
  
                res.redirect('/admin/members');
              }
            );
          } else {
            const insertMonthlySql = `
              INSERT INTO monthly_entries (
                member_id,
                school_name,
                birth_date,
                course,
                start_month,
                sns_permission
              ) VALUES (?, ?, ?, ?, ?, ?)
            `;
  
            db.run(
              insertMonthlySql,
              [id, school_name, birth_date, course, start_month, sns_permission],
              (err) => {
                if (err) {
                  console.error(err);
                  return res.send('月謝会員情報の追加に失敗しました');
                }
  
                res.redirect('/admin/members');
              }
            );
          }
        });
      }
    );
  });

  app.post('/admin/members/:id/delete', requireAdmin, (req, res) => {
    const { id } = req.params;
  
    db.serialize(() => {
      db.run(`DELETE FROM absences WHERE member_id = ?`, [id]);
      db.run(`DELETE FROM monthly_entries WHERE member_id = ?`, [id]);
      db.run(`DELETE FROM reservations WHERE member_id = ?`, [id]);
      db.run(`DELETE FROM members WHERE id = ?`, [id], function (err) {
        if (err) {
          console.error(err);
          return res.send('会員の削除に失敗しました');
        }
  
        res.redirect('/admin/members');
      });
    });
  });
 

  app.get("/mypage/training-logs", (req, res) => {
    if (!req.session.memberId) {
      return res.redirect("/members/login");
    }
  
    const memberId = req.session.memberId;
  
    db.all(
      `
      SELECT *
      FROM training_logs
      WHERE member_id = ?
      ORDER BY date DESC, id DESC
      `,
      [memberId],
      (err, logs) => {
        if (err) {
          console.error(err);
          return res.send("練習日誌の取得中にエラーが発生しました");
        }
  
        res.render("mypage-training-logs", {
          memberId,
          member: req.session.member,
          logs
        });
      }
    );
  });

  app.post("/mypage/training-logs", (req, res) => {
    if (!req.session.memberId) {
      return res.redirect("/members/login");
    }
  
    const memberId = req.session.memberId;
    const { date, title, subtitle, body } = req.body;
  
    db.run(
      `
      INSERT INTO training_logs (member_id, date, title, subtitle, body)
      VALUES (?, ?, ?, ?, ?)
      `,
      [memberId, date, title, subtitle, body],
      function (err) {
        if (err) {
          console.error(err);
          return res.send("練習日誌の保存中にエラーが発生しました");
        }
  
        res.redirect("/mypage/training-logs");
      }
    );
  });


  app.get("/mypage/training-logs/:id", (req, res) => {
    if (!req.session.memberId) {
      return res.redirect("/members/login");
    }
  
    const memberId = req.session.memberId;
    const logId = req.params.id;
  
    db.get(
      `
      SELECT *
      FROM training_logs
      WHERE id = ? AND member_id = ?
      `,
      [logId, memberId],
      (err, log) => {
        if (err) {
          console.error(err);
          return res.send("練習日誌の取得中にエラーが発生しました");
        }
  
        if (!log) {
          return res.status(404).send("練習日誌が見つかりません");
        }
  
        res.render("mypage-training-log-detail", {
          memberId,
          member: req.session.member,
          log
        });
      }
    );
  });

  app.get("/mypage/training-logs/:id/edit", (req, res) => {
    if (!req.session.memberId) {
      return res.redirect("/members/login");
    }
  
    const memberId = req.session.memberId;
    const logId = req.params.id;
  
    db.get(
      `
      SELECT *
      FROM training_logs
      WHERE id = ? AND member_id = ?
      `,
      [logId, memberId],
      (err, log) => {
        if (err) {
          console.error(err);
          return res.send("練習日誌の取得中にエラーが発生しました");
        }
  
        if (!log) {
          return res.status(404).send("練習日誌が見つかりません");
        }
  
        res.render("mypage-training-log-edit", {
          memberId,
          member: req.session.member,
          log
        });
      }
    );
  });

  app.post("/mypage/training-logs/:id/edit", (req, res) => {
    if (!req.session.memberId) {
      return res.redirect("/members/login");
    }
  
    const memberId = req.session.memberId;
    const logId = req.params.id;
    const { date, title, subtitle, body } = req.body;
  
    db.run(
      `
      UPDATE training_logs
      SET date = ?, title = ?, subtitle = ?, body = ?
      WHERE id = ? AND member_id = ?
      `,
      [date, title, subtitle, body, logId, memberId],
      function (err) {
        if (err) {
          console.error(err);
          return res.send("練習日誌の更新中にエラーが発生しました");
        }
  
        res.redirect(`/mypage/training-logs/${logId}`);
      }
    );
  });

  app.post("/mypage/training-logs/:id/delete", (req, res) => {
    if (!req.session.memberId) {
      return res.redirect("/members/login");
    }
  
    const memberId = req.session.memberId;
    const logId = req.params.id;
  
    db.run(
      `
      DELETE FROM training_logs
      WHERE id = ? AND member_id = ?
      `,
      [logId, memberId],
      function (err) {
        if (err) {
          console.error(err);
          return res.send("練習日誌の削除中にエラーが発生しました");
        }
  
        res.redirect("/mypage/training-logs");
      }
    );
  });

  app.get("/admin/members/:id/training-logs", requireAdmin, (req, res) => {
    const memberId = req.params.id;
  
    db.get(
      `SELECT * FROM members WHERE id = ?`,
      [memberId],
      (err, member) => {
        if (err) {
          console.error(err);
          return res.send("会員情報の取得中にエラーが発生しました");
        }
  
        if (!member) {
          return res.status(404).send("会員が見つかりません");
        }
  
        db.all(
          `
          SELECT *
          FROM training_logs
          WHERE member_id = ?
          ORDER BY date DESC, id DESC
          `,
          [memberId],
          (err, logs) => {
            if (err) {
              console.error(err);
              return res.send("練習日誌の取得中にエラーが発生しました");
            }
  
            res.render("admin-member-training-logs", {
              member,
              logs
            });
          }
        );
      }
    );
  });

  app.get("/mypage/records", (req, res) => {
    if (!req.session.memberId) {
      return res.redirect("/members/login");
    }
  
    const memberId = req.session.memberId;
  
    db.all(
      `
      SELECT *
      FROM personal_records
      WHERE member_id = ?
      ORDER BY date DESC, id DESC
      `,
      [memberId],
      (err, records) => {
        if (err) {
          console.error(err);
          return res.send("記録の取得中にエラーが発生しました");
        }
  
        const events = ["50m", "100m", "200m", "400m", "800m", "1500m"];
  
        const unofficialBests = events.map(eventName => {
          const filtered = records.filter(record =>
            record.event_name === eventName &&
            record.record_type === "unofficial"
          );
  
          if (filtered.length === 0) return null;
  
          return filtered.reduce((best, current) => {
            return current.record_number < best.record_number ? current : best;
          });
        }).filter(Boolean);
  
        const officialBests = events.map(eventName => {
          const filtered = records.filter(record =>
            record.event_name === eventName &&
            record.record_type === "official"
          );
  
          if (filtered.length === 0) return null;
  
          return filtered.reduce((best, current) => {
            return current.record_number < best.record_number ? current : best;
          });
        }).filter(Boolean);
  
        res.render("mypage-records", {
          memberId,
          member: req.session.member,
          records,
          unofficialBests,
          officialBests
        });
      }
    );
  });

  app.post("/mypage/records", (req, res) => {
    if (!req.session.memberId) {
      return res.redirect("/members/login");
    }
  
    const memberId = req.session.memberId;
    const { date, event_name, record_display, record_type, meet_name } = req.body;
  
    const timeRegex = /^\d+\.\d{2}$/;

    if (!timeRegex.test(record_display)) {
      return res.send("記録は 8.44 のように「半角数字.小数点2桁」で入力してください");
    }
    
    const record_number = parseFloat(record_display);
  
    db.run(
      `
      INSERT INTO personal_records
      (member_id, date, event_name, record_display, record_number, record_type, meet_name)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [memberId, date, event_name, record_display, record_number, record_type, meet_name],
      function (err) {
        if (err) {
          console.error(err);
          return res.send("記録の保存中にエラーが発生しました");
        }
  
        res.redirect("/mypage/records");
      }
    );
  });

  app.get("/mypage/records/:id/edit", (req, res) => {
    if (!req.session.memberId) {
      return res.redirect("/members/login");
    }
  
    const memberId = req.session.memberId;
    const recordId = req.params.id;
  
    db.get(
      `
      SELECT *
      FROM personal_records
      WHERE id = ? AND member_id = ?
      `,
      [recordId, memberId],
      (err, record) => {
        if (err) {
          console.error(err);
          return res.send("記録の取得中にエラーが発生しました");
        }
  
        if (!record) {
          return res.status(404).send("記録が見つかりません");
        }
  
        res.render("mypage-record-edit", {
          memberId,
          member: req.session.member,
          record
        });
      }
    );
  });

  app.post("/mypage/records/:id/edit", (req, res) => {
    if (!req.session.memberId) {
      return res.redirect("/members/login");
    }
  
    const memberId = req.session.memberId;
    const recordId = req.params.id;
    const { date, event_name, record_display, record_type, meet_name } = req.body;
  
    const timeRegex = /^\d+\.\d{2}$/;
  
    if (!timeRegex.test(record_display)) {
      return res.send("記録は 8.44 のように「数字.小数点2桁」で入力してください");
    }
  
    const record_number = parseFloat(record_display);
  
    db.run(
      `
      UPDATE personal_records
      SET date = ?,
          event_name = ?,
          record_display = ?,
          record_number = ?,
          record_type = ?,
          meet_name = ?
      WHERE id = ? AND member_id = ?
      `,
      [date, event_name, record_display, record_number, record_type, meet_name, recordId, memberId],
      function (err) {
        if (err) {
          console.error(err);
          return res.send("記録の更新中にエラーが発生しました");
        }
  
        res.redirect("/mypage/records");
      }
    );
  });


  app.post("/admin/reservations/:id/delete", (req, res) => {
    const reservationId = req.params.id;
  
    db.run(
      `DELETE FROM reservations WHERE id = ?`,
      [reservationId],
      function (err) {
        if (err) {
          console.error(err);
          return res.send("削除中にエラーが発生しました");
        }
  
        // 削除後は一覧に戻す
        res.redirect("/admin/reservations");
      }
    );
  });

  app.get("/admin/members/:id/records", (req, res) => {
    const memberId = req.params.id;
  
    db.all(
      `
      SELECT *
      FROM personal_records
      WHERE member_id = ?
      ORDER BY date DESC, id DESC
      `,
      [memberId],
      (err, records) => {
        if (err) {
          console.error(err);
          return res.send("記録の取得中にエラーが発生しました");
        }
  
        db.get(
          `SELECT * FROM members WHERE id = ?`,
          [memberId],
          (err, member) => {
            if (err) {
              console.error(err);
              return res.send("会員情報の取得中にエラーが発生しました");
            }
  
            if (!member) {
              return res.status(404).send("会員が見つかりません");
            }
  
            const events = ["50m", "100m", "200m", "400m", "800m", "1500m"];
  
            const unofficialBests = events.map(eventName => {
              const filtered = records.filter(record =>
                record.event_name === eventName &&
                record.record_type === "unofficial"
              );
  
              if (filtered.length === 0) return null;
  
              return filtered.reduce((best, current) => {
                return current.record_number < best.record_number ? current : best;
              });
            }).filter(Boolean);
  
            const officialBests = events.map(eventName => {
              const filtered = records.filter(record =>
                record.event_name === eventName &&
                record.record_type === "official"
              );
  
              if (filtered.length === 0) return null;
  
              return filtered.reduce((best, current) => {
                return current.record_number < best.record_number ? current : best;
              });
            }).filter(Boolean);
  
            res.render("admin-member-records", {
              records,
              member,
              unofficialBests,
              officialBests,
              success: req.query.success
            });
          }
        );
      }
    );
  });


  app.post("/admin/members/:id/records", (req, res) => {
    const memberId = req.params.id;
    const { date, event_name, record_display, record_type, meet_name } = req.body;
  
    const timeRegex = /^\d+\.\d{2}$/;
  
    if (!timeRegex.test(record_display)) {
      return res.send("記録は 8.44 のように「数字.小数点2桁」で入力してください");
    }
  
    const record_number = parseFloat(record_display);
  
    db.run(
      `
      INSERT INTO personal_records
      (member_id, date, event_name, record_display, record_number, record_type, meet_name)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [memberId, date, event_name, record_display, record_number, record_type, meet_name],
      function (err) {
        if (err) {
          console.error(err);
          return res.send("記録の保存中にエラーが発生しました");
        }
  
        res.redirect(`/admin/members/${memberId}/records?success=1`);
      }
    );
  });


  app.listen(PORT, () => {
    console.log("server start");
  });