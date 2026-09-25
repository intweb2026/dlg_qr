# PyMySQL acts as a drop-in replacement for mysqlclient (no C compiler needed on Windows).
import pymysql

pymysql.install_as_MySQLdb()
