import json
import pandas as pd
import matplotlib.pyplot as plt

# --- CONFIGURATION ---
INPUT_MAIN = "fandom_edits.json"
INPUT_BOT = "fandom_edits_bot.json"
OUTPUT_CHART = "fandom_activity_comparison.png"
# ---------------------

print("Loading data...")
try:
    with open(INPUT_MAIN, "r", encoding="utf-8") as f:
        main_contribs = json.load(f)
except FileNotFoundError:
    print(f"Error: File {INPUT_MAIN} not found.")
    exit()

try:
    with open(INPUT_BOT, "r", encoding="utf-8") as f:
        bot_contribs = json.load(f)
except FileNotFoundError:
    print(f"Warning: File {INPUT_BOT} not found. Continuing without bot data.")
    bot_contribs = []

# --- 1. Processing Main User Data (Robal91) ---
df_main = pd.DataFrame(main_contribs)
df_main['datetime'] = pd.to_datetime(df_main['timestamp'])

# Daily data for Robal91
df_main['date'] = df_main['datetime'].dt.date
daily_main = df_main.groupby('date').size().reset_index(name='edits')
daily_main['date'] = pd.to_datetime(daily_main['date'])
daily_main = daily_main.set_index('date').resample('D').asfreq().fillna(0).reset_index()
daily_main['rolling_avg'] = daily_main['edits'].rolling(window=30).mean()

# Monthly data for Robal91
df_main['month'] = df_main['datetime'].dt.to_period('M')
monthly_main = df_main.groupby('month').size().reset_index(name='edits_main')
monthly_main['month'] = monthly_main['month'].dt.to_timestamp()

# --- 2. Processing Bot Data (RobalBot) ---
if bot_contribs:
    df_bot = pd.DataFrame(bot_contribs)
    df_bot['datetime'] = pd.to_datetime(df_bot['timestamp'])
    
    # Daily data for RobalBot
    df_bot['date'] = df_bot['datetime'].dt.date
    daily_bot = df_bot.groupby('date').size().reset_index(name='edits')
    daily_bot['date'] = pd.to_datetime(daily_bot['date'])
    daily_bot = daily_bot.set_index('date').resample('D').asfreq().fillna(0).reset_index()
    daily_bot['rolling_avg'] = daily_bot['edits'].rolling(window=30).mean()

    # Monthly data for RobalBot
    df_bot['month'] = df_bot['datetime'].dt.to_period('M')
    monthly_bot = df_bot.groupby('month').size().reset_index(name='edits_bot')
    monthly_bot['month'] = monthly_bot['month'].dt.to_timestamp()
    
    monthly_combined = pd.merge(monthly_main, monthly_bot, on='month', how='outer').fillna(0)
else:
    daily_bot = pd.DataFrame(columns=['date', 'edits', 'rolling_avg'])
    monthly_combined = monthly_main.copy()
    monthly_combined['edits_bot'] = 0

monthly_combined = monthly_combined.sort_values('month')

# --- 3. Plotting (3 subplots stacked vertically) ---
fig, (ax1, ax2, ax3) = plt.subplots(3, 1, figsize=(14, 13))

# Chart 1: Daily Activity (Line - Robal91)
ax1.plot(daily_main['date'], daily_main['edits'], color='#00b6d3', linewidth=0.8, alpha=0.5, label='Robal91 - Daily Edits')
ax1.plot(daily_main['date'], daily_main['rolling_avg'], color='#ff7f0e', linewidth=2, label='Robal91 - 30-day Moving Average')
ax1.set_xlabel("Year / Date", fontsize=10)
ax1.set_ylabel("Number of Edits", fontsize=10)
ax1.legend(loc='upper right')
ax1.grid(True, linestyle='--', alpha=0.4)

# Chart 2: Daily Activity (Line - RobalBot)
if bot_contribs:
    ax2.plot(daily_bot['date'], daily_bot['edits'], color='#d62728', linewidth=0.8, alpha=0.5, label='RobalBot - Daily Edits')
    ax2.plot(daily_bot['date'], daily_bot['rolling_avg'], color='#8c564b', linewidth=2, label='RobalBot - 30-day Moving Average')
else:
    ax2.text(0.5, 0.5, 'No Bot Data Available', horizontalalignment='center', verticalalignment='center', transform=ax2.transAxes)
ax2.set_xlabel("Year / Date", fontsize=10)
ax2.set_ylabel("Number of Edits", fontsize=10)
ax2.legend(loc='upper right')
ax2.grid(True, linestyle='--', alpha=0.4)

# Chart 3: Stacked Monthly Activity (Robal91 + RobalBot)
ax3.bar(monthly_combined['month'], monthly_combined['edits_main'], width=20, color='#2ca02c', alpha=0.8, label='Robal91')
ax3.bar(monthly_combined['month'], monthly_combined['edits_bot'], width=20, bottom=monthly_combined['edits_main'], color='#d62728', alpha=0.8, label='RobalBot')
ax3.set_xlabel("Year / Month", fontsize=10)
ax3.set_ylabel("Number of Edits", fontsize=10)
ax3.legend(loc='upper right')
ax3.grid(True, linestyle='--', alpha=0.4)

# --- UNIFIED X-AXIS SCALE (2020-01-01 to 2027-04-01) ---
start_date = pd.to_datetime('2020-01-01')
end_date = pd.to_datetime('2027-04-01')

for ax in [ax1, ax2, ax3]:
    ax.set_xlim(start_date, end_date)

# Overall layout adjustments
total_edits = len(df_main) + (len(df_bot) if bot_contribs else 0)
fig.suptitle(f"Fandom Contribution Analysis (Robal91 & RobalBot) – Total Edits: {total_edits:,}", fontsize=15, y=0.97)
plt.tight_layout(rect=[0, 0, 1, 0.95])
fig.subplots_adjust(hspace=0.4)

# Save output chart
plt.savefig(OUTPUT_CHART, dpi=300, bbox_inches='tight')
print(f"Chart successfully saved as: {OUTPUT_CHART}")

plt.show()